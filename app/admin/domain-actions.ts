"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/activity/admin-log";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import {
  OPEN_REQUEST_STATUSES,
  type DomainRequestStatus,
} from "@/lib/sites/domain-queries";
import { disconnectDomain, requestDomainCheck, reserveDomainSetup } from "@/lib/sites/domain-onboarding";
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

  const saved = await reserveDomainSetup({ churchId: input.churchId, hostname: input.hostname, userId: null });
  if (!saved.ok) return fail(saved.error);
  // A replacement address never takes over from a working primary while it is pending.
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
  const { data, error } = await createAdminClient().rpc("set_primary_site_domain", { p_church_id: churchId, p_domain_id: domainId });
  return error || data !== true ? "Only a connected main address can become the primary website address." : null;
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

  if (!(await requestDomainCheck(domain.church_id as string, domainId))) {
    return fail("We couldn't schedule that connection check.");
  }
  refresh(domain.church_id as string);
  return { ok: true };
}

export async function recheckDomain(domainId: string): Promise<AdminDomainResult> {
  return markDomainLive(domainId);
}

/**
 * Stops routing and queues provider release. The reservation stays in place
 * until that release succeeds, including through retries and provider outages.
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

  if (!(await disconnectDomain(domain.church_id as string, domainId, supabase))) {
    return fail("We couldn't disconnect that address. Please try again.");
  }

  await logAdminAction({
    churchId: domain.church_id as string,
    taskName: `Domain disconnect requested: ${domain.hostname}`,
    triggerSource: "Control center",
  });

  refresh(domain.church_id as string);
  return { ok: true };
}
