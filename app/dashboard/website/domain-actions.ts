"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireChurchAuth } from "@/lib/auth/church";
import { sendDomainRequestEmail } from "@/lib/email/domain-request";
import { featureActionError } from "@/lib/features/guard";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import {
  getChurchDomains,
  getOpenDomainRequest,
  hostnameClaim,
  type DomainStatus,
} from "@/lib/sites/domain-queries";
import {
  checkDns,
  getDomainProvider,
  normalizeHostname,
} from "@/lib/sites/domains";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Church-facing domain mutations.
 *
 * Same three-step opening as the rest of the Website section: authenticate,
 * check the `website` feature, prove the row belongs to the caller's church.
 * Only then does the service-role client come out — which it must, because
 * `site_domains` has no write policies by design (0042).
 *
 * A hostname claim is not an ordinary content edit. It decides which church a
 * request routes to for everyone, so these actions never trust a hostname that
 * has not been through `normalizeHostname` and a uniqueness check first.
 */

export type DomainActionResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

type Guard =
  | { ok: true; churchId: string; userId: string }
  | { ok: false; error: string };

/** Domains are a church-admin decision; view-only members can look, not claim. */
async function guardAdmin(): Promise<Guard> {
  const auth = await requireChurchAuth().catch(() => null);
  if (!auth) return { ok: false, error: "You are not signed in." };

  const featureError = await featureActionError("website");
  if (featureError) return { ok: false, error: featureError };

  if (!auth.isAdmin) {
    return {
      ok: false,
      error: "Only church admins can change your web address.",
    };
  }

  return { ok: true, churchId: auth.churchId, userId: auth.userId };
}

function refresh(churchId: string) {
  revalidatePath("/dashboard/website");
  revalidatePath("/dashboard/website/domain");
  revalidatePath("/admin/domains");
  revalidatePath(`/admin/churches/${churchId}`);
}

// ---------------------------------------------------------------------------
// SUBMIT A REQUEST
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  kind: z.enum(["connect_existing", "register_new"]),
  hostname: z.string().trim().max(253).optional().default(""),
  alternateHostnames: z.array(z.string().trim().max(253)).max(5).default([]),
  registrar: z.string().trim().max(80).optional().default(""),
  contactName: z.string().trim().max(120).optional().default(""),
  contactEmail: z.string().trim().max(200).optional().default(""),
  contactPhone: z.string().trim().max(40).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

export type DomainRequestInput = z.input<typeof requestSchema>;

export type SubmitDomainRequestResult =
  | { ok: true; kind: "connect_existing"; hostname: string }
  | { ok: true; kind: "register_new"; hostname: string | null }
  | { ok: false; error: string };

/**
 * Files a domain request and, when the church already owns the domain, creates
 * the routing row at the same time.
 *
 * The two halves are deliberate. `connect_existing` has work the church can do
 * this minute — add two DNS records — so making them wait on our queue before
 * they can even see the records would waste the day they set aside for it. The
 * request still lands in the control center, because Vercel will not answer for
 * the hostname until it is on the project, and that is our half.
 *
 * `register_new` creates no domain row: we do not own a name yet, and an
 * unverified row for a hostname nobody has bought would be a lie in the routing
 * table.
 */
export async function submitDomainRequest(
  input: DomainRequestInput,
): Promise<SubmitDomainRequestResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Some of those details weren't valid. Check the form and retry.");
  }

  const values = parsed.data;
  const supabase = createAdminClient();

  const existing = await getOpenDomainRequest(auth.churchId);
  if (existing) {
    return fail(
      "You already have a domain request open. Cancel it first if you'd like to start over.",
    );
  }

  // Validate the primary hostname. Required for connect_existing, optional for
  // register_new — a church with no domain may have no idea what to call it,
  // and forcing a guess would be a worse conversation than an empty field.
  let hostname: string | null = null;

  if (values.hostname) {
    const result = normalizeHostname(values.hostname);
    if (!result.ok) return fail(result.error);
    hostname = result.hostname;
  } else if (values.kind === "connect_existing") {
    return fail("Enter the domain you'd like to connect.");
  }

  const alternates: string[] = [];
  for (const raw of values.alternateHostnames) {
    if (!raw) continue;
    const result = normalizeHostname(raw);
    if (!result.ok) return fail(result.error);
    if (result.hostname !== hostname && !alternates.includes(result.hostname)) {
      alternates.push(result.hostname);
    }
  }

  if (hostname) {
    const claim = await hostnameClaim(hostname);
    if (claim && claim.churchId !== auth.churchId) {
      // Deliberately does not name the other church — that a hostname is taken
      // is fine to reveal; who took it is not ours to disclose.
      return fail(
        `${hostname} is already connected to another FaithForm account. Contact us if that's a mistake.`,
      );
    }
  }

  // For connect_existing, the routing row goes in first: if the request insert
  // fails, a church with a working domain is a better outcome than a queue
  // entry pointing at nothing.
  let domainId: string | null = null;

  if (values.kind === "connect_existing" && hostname) {
    const created = await ensureDomainRow({
      churchId: auth.churchId,
      hostname,
      userId: auth.userId,
    });

    if (!created.ok) return fail(created.error);
    domainId = created.domainId;
  }

  const { error } = await supabase.from("site_domain_requests").insert({
    church_id: auth.churchId,
    requested_by: auth.userId,
    kind: values.kind,
    hostname,
    alternate_hostnames: alternates,
    registrar: values.registrar || null,
    contact_name: values.contactName || null,
    contact_email: values.contactEmail || null,
    contact_phone: values.contactPhone || null,
    notes: values.notes || null,
    status: "submitted",
    domain_id: domainId,
  });

  if (error) {
    // The partial unique index is the only race this insert can lose.
    if (/site_domain_requests_one_open_idx/.test(error.message)) {
      return fail("You already have a domain request open.");
    }
    return fail(error.message);
  }

  const { data: church } = await supabase
    .from("churches")
    .select("name")
    .eq("id", auth.churchId)
    .maybeSingle();

  // Fire-and-forget: the request is committed, so a mail failure must not
  // surface as a failed submission.
  void sendDomainRequestEmail({
    churchName: (church?.name as string | undefined) ?? "A church",
    kind: values.kind,
    hostname,
    alternateHostnames: alternates,
    registrar: values.registrar || null,
    contactName: values.contactName || null,
    contactEmail: values.contactEmail || null,
    contactPhone: values.contactPhone || null,
    notes: values.notes || null,
    reviewUrl: `${getCanonicalSiteUrl()}/admin/churches/${auth.churchId}?tab=website`,
  });

  refresh(auth.churchId);

  return values.kind === "connect_existing"
    ? { ok: true, kind: "connect_existing", hostname: hostname as string }
    : { ok: true, kind: "register_new", hostname };
}

/**
 * Creates the `site_domains` row for a hostname, or returns the existing one.
 *
 * Registers with the platform provider first. When Vercel automation is
 * configured this is what actually makes the hostname servable; when it is not,
 * the manual provider is a no-op and a platform admin does it from the control
 * center.
 */
async function ensureDomainRow(params: {
  churchId: string;
  hostname: string;
  userId: string | null;
}): Promise<{ ok: true; domainId: string } | { ok: false; error: string }> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("site_domains")
    .select("id, church_id")
    .eq("hostname", params.hostname)
    .maybeSingle();

  if (existing) {
    if (existing.church_id !== params.churchId) {
      return { ok: false, error: "That domain belongs to another account." };
    }
    return { ok: true, domainId: existing.id as string };
  }

  const provider = getDomainProvider();
  const registered = await provider.register(params.hostname);

  if (!registered.ok) {
    return { ok: false, error: registered.error };
  }

  const dns = await checkDns(params.hostname);
  const status: DomainStatus = registered.serving
    ? "live"
    : dns.ok
      ? "dns_ok"
      : "pending_dns";

  // First domain for a church becomes primary; middleware resolves any of them,
  // but the dashboard needs one canonical URL to show.
  const { count } = await supabase
    .from("site_domains")
    .select("id", { count: "exact", head: true })
    .eq("church_id", params.churchId);

  const { data, error } = await supabase
    .from("site_domains")
    .insert({
      church_id: params.churchId,
      hostname: params.hostname,
      is_primary: (count ?? 0) === 0,
      status,
      verified_at: status === "live" ? new Date().toISOString() : null,
      dns_checked_at: new Date().toISOString(),
      dns_detail: dns.detail,
      provider: provider.name,
      provider_domain_id: registered.providerDomainId,
      requested_by: params.userId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  return { ok: true, domainId: data.id as string };
}

// ---------------------------------------------------------------------------
// CANCEL
// ---------------------------------------------------------------------------

export async function cancelDomainRequest(
  requestId: string,
): Promise<DomainActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const supabase = createAdminClient();

  // Scoped by church_id as well as id, so a guessed uuid cannot cancel another
  // church's request.
  const { data, error } = await supabase
    .from("site_domain_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("church_id", auth.churchId)
    .in("status", ["submitted", "in_review", "awaiting_church"])
    .select("id");

  if (error) return fail(error.message);

  if (!data || data.length === 0) {
    return fail(
      "That request can no longer be cancelled — we've already started work on it.",
    );
  }

  refresh(auth.churchId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// RE-CHECK DNS
// ---------------------------------------------------------------------------

/** Records propagate in minutes, not seconds; this stops a button-mash loop. */
const RECHECK_COOLDOWN_MS = 15_000;

export type DnsRecheckResult =
  | { ok: true; dnsOk: boolean; detail: string; status: DomainStatus }
  | { ok: false; error: string };

/**
 * Re-runs the DNS check for one of this church's domains and, when automation
 * is configured, asks the platform whether it is serving yet.
 *
 * Deliberately never sets `live` off DNS alone. Correct DNS means the church
 * finished their half; a green check before the hostname actually answers would
 * send them to a URL that errors.
 */
export async function recheckDomainDns(
  domainId: string,
): Promise<DnsRecheckResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const domains = await getChurchDomains(auth.churchId);
  const domain = domains.find((d) => d.id === domainId);

  if (!domain) return fail("We couldn't find that domain on your account.");

  if (
    domain.dnsCheckedAt &&
    Date.now() - new Date(domain.dnsCheckedAt).getTime() < RECHECK_COOLDOWN_MS
  ) {
    return {
      ok: true,
      dnsOk: domain.status === "dns_ok" || domain.status === "live",
      detail: domain.dnsDetail ?? "Just checked — give it a moment.",
      status: domain.status,
    };
  }

  const dns = await checkDns(domain.hostname);

  const provider = getDomainProvider();
  const platform = provider.automated
    ? await provider.status(domain.hostname)
    : null;
  const serving = platform?.ok === true && platform.serving;

  const status: DomainStatus = serving
    ? "live"
    : dns.ok
      ? // A domain already switched on stays on while its DNS still resolves.
        // Only the automated provider can tell us more than "DNS is correct",
        // so without it, demoting a working site to "finishing setup" would be
        // a regression the check invented.
        domain.status === "live"
        ? "live"
        : "dns_ok"
      : domain.status === "live"
        ? // A live domain whose DNS stopped resolving is a real regression, but
          // "failed" is the honest label for it rather than silently staying green.
          "failed"
        : "pending_dns";

  const { error } = await createAdminClient()
    .from("site_domains")
    .update({
      status,
      dns_checked_at: new Date().toISOString(),
      dns_detail: dns.detail,
      verified_at:
        status === "live"
          ? (domain.verifiedAt ?? new Date().toISOString())
          : null,
      ...(platform?.ok && platform.providerDomainId
        ? { provider_domain_id: platform.providerDomainId, provider: provider.name }
        : {}),
    })
    .eq("id", domainId)
    .eq("church_id", auth.churchId);

  if (error) return fail(error.message);

  refresh(auth.churchId);

  return { ok: true, dnsOk: dns.ok, detail: dns.detail, status };
}
