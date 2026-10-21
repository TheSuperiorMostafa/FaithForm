import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { isNotionSupportConfigured, syncNotionTicket } from "@/lib/support/notion";

type DeliveryResult = "sent" | "deferred" | "skipped" | "disabled";
type Claim = { ticket_id: string; lease_token: string; attempts: number };
type SyncTicket = Parameters<typeof syncNotionTicket>[0];

/** Dependency injection keeps retry/lease tests independent of live services. */
export type NotionDeliveryDependencies = {
  configured: () => boolean;
  sync: (ticket: SyncTicket) => Promise<void>;
  now: () => number;
};

const defaults: NotionDeliveryDependencies = {
  configured: isNotionSupportConfigured,
  sync: syncNotionTicket,
  now: Date.now,
};

async function deliverClaim(
  claim: Claim,
  client: SupabaseClient,
  deps: NotionDeliveryDependencies,
): Promise<DeliveryResult> {
  let sent = false;
  try {
    const { data: ticket, error } = await client
      .from("support_tickets")
      .select("id, church_id, subject, body, priority")
      .eq("id", claim.ticket_id)
      .maybeSingle();
    if (error || !ticket) throw new Error("ticket_read_failed");

    let churchName = "FaithForm";
    if (ticket.church_id) {
      const { data: church, error: churchError } = await client
        .from("churches")
        .select("name")
        .eq("id", ticket.church_id)
        .maybeSingle();
      if (churchError) throw new Error("church_read_failed");
      // Never deliver a misleading placeholder for a still-linked church.
      if (!church?.name) throw new Error("church_not_found");
      churchName = church.name as string;
    }

    await deps.sync({
      id: ticket.id as string,
      churchName,
      subject: ticket.subject as string,
      body: (ticket.body as string | null) ?? null,
      priority: ticket.priority as string,
    });
    sent = true;
  } catch {
    // Do not log ticket content or provider messages (which may echo it).
    console.warn("[support] Notion delivery deferred.");
  }

  const now = deps.now();
  const retryDelay = Math.min(60_000 * 2 ** Math.min(Math.max(claim.attempts - 1, 0), 10), 24 * 60 * 60_000);
  const { data: completed, error: completionError } = await client
    .from("support_notion_outbox")
    .update({
      lease_token: null,
      lease_until: null,
      delivered_at: sent ? new Date(now).toISOString() : null,
      available_at: new Date(now + retryDelay).toISOString(),
      last_error_code: sent ? null : "delivery_failed",
    })
    .eq("ticket_id", claim.ticket_id)
    .eq("lease_token", claim.lease_token)
    .select("ticket_id")
    .maybeSingle();

  // A failed completion leaves the lease intact. The next worker recovers the
  // existing Notion page/comment using the ticket ID instead of duplicating it.
  if (completionError || !completed) return "deferred";
  return sent ? "sent" : "deferred";
}

/** A committed ticket must remain successful even if Notion/schema is offline. */
export async function deliverSupportTicketToNotion(
  ticketId: string,
  client?: SupabaseClient,
  deps: NotionDeliveryDependencies = defaults,
): Promise<DeliveryResult> {
  if (!deps.configured()) return "disabled";
  try {
    const admin = client ?? createAdminClient();
    const { data, error } = await admin.rpc("claim_support_notion_ticket", {
      p_ticket_id: ticketId,
    });
    if (error) return "deferred";
    const claim = data?.[0] as Claim | undefined;
    if (!claim) return "skipped";
    return await deliverClaim(claim, admin, deps);
  } catch {
    console.warn("[support] Notion delivery deferred.");
    return "deferred";
  }
}

export async function retryPendingSupportNotionTickets(
  client?: SupabaseClient,
  deps: NotionDeliveryDependencies = defaults,
): Promise<{ configured: boolean; sent: number; deferred: number; failed: boolean }> {
  const result = { configured: deps.configured(), sent: 0, deferred: 0, failed: false };
  if (!result.configured) return result;

  try {
    const admin = client ?? createAdminClient();
    const deadline = deps.now() + 20_000;
    // Bound both work count and start time; the route has a 60-second budget.
    for (let i = 0; i < 10 && deps.now() < deadline; i += 1) {
      const { data, error } = await admin.rpc("claim_support_notion_ticket", {
        p_ticket_id: null,
      });
      if (error) {
        result.failed = true;
        break;
      }
      const claim = data?.[0] as Claim | undefined;
      if (!claim) break;
      const status = await deliverClaim(claim, admin, deps);
      if (status === "sent") result.sent += 1;
      else result.deferred += 1;
    }
  } catch {
    result.failed = true;
    console.warn("[support] Notion retry deferred.");
  }
  return result;
}
