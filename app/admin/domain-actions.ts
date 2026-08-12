"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/activity/admin-log";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import {
  OPEN_REQUEST_STATUSES,
  type DomainRequestStatus,
  type DomainStatus,
} from "@/lib/sites/domain-queries";
import {
  checkDns,
  getDomainProvider,
  normalizeHostname,
} from "@/lib/sites/domains";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Control-center domain mutations.
 *
 * The church-facing actions in app/dashboard/website/domain-actions.ts are
 * bounded to one church and refuse anything that touches another. These are
 * the opposite: they exist to do the things a church may not, so every one of
 * them opens with requireSuperAdmin() and nothing else is inferred from the
 * caller.
 */

export type AdminDomainResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const REQUEST_STATUSES: DomainRequestStatus[] = [
  "submitted",
  "in_review",
  "awaiting_church",
  "in_progress",
  "completed",
  "declined",
  "cancelled",
];

function refresh(churchId?: string) {
  revalidatePath("/admin/domains");
  revalidatePath("/admin");
  if (churchId) {
    revalidatePath(`/admin/churches/${churchId}`);
  }
  // The church's own Website section reads these rows.
  revalidatePath("/dashboard/website", "layout");
}

// ---------------------------------------------------------------------------
// REQUEST TRIAGE
// ---------------------------------------------------------------------------

export async function updateDomainRequest(input: {
  requestId: string;
  status: DomainRequestStatus;
  adminNotes?: string;
}): Promise<AdminDomainResult> {
  const user = await requireSuperAdmin();

  if (!REQUEST_STATUSES.includes(input.status)) {
    return fail("Unknown status.");
  }

  const supabase = createAdminClient();

  const { data: request } = await supabase
    .from("site_domain_requests")
    .select("church_id, status")
    .eq("id", input.requestId)
    .maybeSingle();

  if (!request) return fail("Request not found.");

  const leavingOpen =
    OPEN_REQUEST_STATUSES.includes(request.status as DomainRequestStatus) &&
    !OPEN_REQUEST_STATUSES.includes(input.status);

  const { error } = await supabase
    .from("site_domain_requests")
    .update({
      status: input.status,
      admin_notes: input.adminNotes?.trim() || null,
      handled_by: user.id,
      // Stamped when the request leaves the queue, so "how long did this take"
      // is answerable without reconstructing it from an audit log.
      ...(leavingOpen ? { handled_at: new Date().toISOString() } : {}),
    })
    .eq("id", input.requestId);

  if (error) return fail(error.message);

  await logAdminAction({
    churchId: request.church_id as string,
    taskName: `Domain request → ${input.status}`,
    triggerSource: "Control center",
  });

  refresh(request.church_id as string);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DOMAINS
// ---------------------------------------------------------------------------

/**
 * Attaches a hostname to a church. This is the platform half of the job: with
 * Vercel automation configured it registers the domain against the project,
 * and without it the row is created so routing works the moment a person has
 * added it by hand.
 */
export async function addChurchDomain(input: {
  churchId: string;
  hostname: string;
  makePrimary?: boolean;
}): Promise<AdminDomainResult> {
  await requireSuperAdmin();

  const normalized = normalizeHostname(input.hostname);
  if (!normalized.ok) return fail(normalized.error);

  const hostname = normalized.hostname;
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("site_domains")
    .select("id, church_id")
    .eq("hostname", hostname)
    .maybeSingle();

  if (existing && existing.church_id !== input.churchId) {
    return fail(`${hostname} is already attached to another church.`);
  }

  const provider = getDomainProvider();
  const registered = await provider.register(hostname);
  if (!registered.ok) return fail(registered.error);

  const dns = await checkDns(hostname);
  const status: DomainStatus = registered.serving
    ? "live"
    : dns.ok
      ? "dns_ok"
      : "pending_dns";

  const now = new Date().toISOString();

  if (existing) {
    const { error } = await supabase
      .from("site_domains")
      .update({
        status,
        dns_checked_at: now,
        dns_detail: dns.detail,
        provider: provider.name,
        provider_domain_id: registered.providerDomainId,
        verified_at: status === "live" ? now : null,
      })
      .eq("id", existing.id);

    if (error) return fail(error.message);
  } else {
    const { count } = await supabase
      .from("site_domains")
      .select("id", { count: "exact", head: true })
      .eq("church_id", input.churchId);

    const { error } = await supabase.from("site_domains").insert({
      church_id: input.churchId,
      hostname,
      is_primary: (count ?? 0) === 0,
      status,
      verified_at: status === "live" ? now : null,
      dns_checked_at: now,
      dns_detail: dns.detail,
      provider: provider.name,
      provider_domain_id: registered.providerDomainId,
    });

    if (error) return fail(error.message);
  }

  if (input.makePrimary) {
    const { data: row } = await supabase
      .from("site_domains")
      .select("id")
      .eq("hostname", hostname)
      .maybeSingle();

    if (row) await promotePrimary(row.id as string, input.churchId);
  }

  await logAdminAction({
    churchId: input.churchId,
    taskName: `Domain attached: ${hostname}`,
    triggerSource: "Control center",
  });

  refresh(input.churchId);
  return { ok: true };
}

/**
 * `site_domains_one_primary_idx` allows a single primary per church, so the
 * old one has to be cleared before the new one is set — a plain update of the
 * new row would violate the index.
 */
async function promotePrimary(
  domainId: string,
  churchId: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { error: clearError } = await supabase
    .from("site_domains")
    .update({ is_primary: false })
    .eq("church_id", churchId)
    .eq("is_primary", true)
    .neq("id", domainId);

  if (clearError) return clearError.message;

  const { error } = await supabase
    .from("site_domains")
    .update({ is_primary: true })
    .eq("id", domainId)
    .eq("church_id", churchId);

  return error?.message ?? null;
}

export async function setPrimaryDomain(
  domainId: string,
): Promise<AdminDomainResult> {
  await requireSuperAdmin();

  const { data: domain } = await createAdminClient()
    .from("site_domains")
    .select("church_id, hostname")
    .eq("id", domainId)
    .maybeSingle();

  if (!domain) return fail("Domain not found.");

  const error = await promotePrimary(domainId, domain.church_id as string);
  if (error) return fail(error);

  refresh(domain.church_id as string);
  return { ok: true };
}

/**
 * Marks a domain as serving.
 *
 * With automation on, this asks the provider rather than taking the admin's
 * word for it — a green badge on a hostname that does not answer is the exact
 * failure this whole status field exists to prevent. With automation off there
 * is nothing to ask, so the admin's confirmation is the signal, which is why
 * the button is only reachable from the control center.
 */
export async function markDomainLive(
  domainId: string,
): Promise<AdminDomainResult> {
  await requireSuperAdmin();

  const supabase = createAdminClient();

  const { data: domain } = await supabase
    .from("site_domains")
    .select("church_id, hostname")
    .eq("id", domainId)
    .maybeSingle();

  if (!domain) return fail("Domain not found.");

  const hostname = domain.hostname as string;
  const provider = getDomainProvider();

  if (provider.automated) {
    const status = await provider.status(hostname);
    if (!status.ok) return fail(status.error);
    if (!status.serving) {
      return fail(
        `${hostname} isn't serving yet — the platform still reports it as misconfigured.`,
      );
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("site_domains")
    .update({ status: "live", verified_at: now })
    .eq("id", domainId);

  if (error) return fail(error.message);

  // A domain going live closes the request that asked for it.
  await supabase
    .from("site_domain_requests")
    .update({ status: "completed", handled_at: now, domain_id: domainId })
    .eq("church_id", domain.church_id as string)
    .in("status", OPEN_REQUEST_STATUSES);

  await logAdminAction({
    churchId: domain.church_id as string,
    taskName: `Domain live: ${hostname}`,
    triggerSource: "Control center",
  });

  refresh(domain.church_id as string);
  return { ok: true };
}

export async function recheckDomain(
  domainId: string,
): Promise<AdminDomainResult> {
  await requireSuperAdmin();

  const supabase = createAdminClient();

  const { data: domain } = await supabase
    .from("site_domains")
    .select("church_id, hostname, verified_at, status")
    .eq("id", domainId)
    .maybeSingle();

  if (!domain) return fail("Domain not found.");

  const hostname = domain.hostname as string;
  const wasLive = domain.status === "live";
  const dns = await checkDns(hostname);

  const provider = getDomainProvider();
  const platform = provider.automated ? await provider.status(hostname) : null;
  const serving = platform?.ok === true && platform.serving;

  // Same rule as the church-facing re-check: a domain already switched on
  // stays on while its DNS resolves. Without automation there is nothing that
  // could tell us otherwise, so a re-check must not be able to take a working
  // site backwards.
  const status: DomainStatus = serving
    ? "live"
    : dns.ok
      ? wasLive
        ? "live"
        : "dns_ok"
      : wasLive
        ? "failed"
        : "pending_dns";

  const { error } = await supabase
    .from("site_domains")
    .update({
      status,
      dns_checked_at: new Date().toISOString(),
      dns_detail: dns.detail,
      verified_at:
        status === "live"
          ? ((domain.verified_at as string | null) ?? new Date().toISOString())
          : null,
    })
    .eq("id", domainId);

  if (error) return fail(error.message);

  refresh(domain.church_id as string);
  return { ok: true };
}

/**
 * Detaches a hostname. Routing stops immediately, so this also releases it at
 * the provider — leaving it registered against the project would block another
 * church from ever claiming it.
 */
export async function removeChurchDomain(
  domainId: string,
): Promise<AdminDomainResult> {
  await requireSuperAdmin();

  const supabase = createAdminClient();

  const { data: domain } = await supabase
    .from("site_domains")
    .select("church_id, hostname")
    .eq("id", domainId)
    .maybeSingle();

  if (!domain) return fail("Domain not found.");

  const hostname = domain.hostname as string;
  const provider = getDomainProvider();

  const released = await provider.remove(hostname);
  if (!released.ok) return fail(released.error);

  const { error } = await supabase
    .from("site_domains")
    .delete()
    .eq("id", domainId);

  if (error) return fail(error.message);

  await logAdminAction({
    churchId: domain.church_id as string,
    taskName: `Domain removed: ${hostname}`,
    triggerSource: "Control center",
  });

  refresh(domain.church_id as string);
  return { ok: true };
}
