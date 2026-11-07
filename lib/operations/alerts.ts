import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { renderEmail } from "@/lib/email/layout";
import { SUPPORT_EMAIL } from "@/lib/email/support-ticket";
import { checkOperationsHealth, type OperationsHealth } from "@/lib/operations/health";
import { createAdminClient } from "@/lib/supabase/admin";

const CHECK_LABELS: Record<string, string> = {
  payment_events_terminal: "Payment events failed",
  payment_events_overdue: "Payment event retries overdue",
  payment_event_leases_stalled: "Payment workers stalled",
  receipts_terminal: "Receipt deliveries failed",
  receipts_pending_overdue: "Receipts pending too long",
  receipts_retry_overdue: "Receipt retries overdue",
  receipts_leases_stalled: "Receipt workers stalled",
  notifications_failed: "Notifications failed",
  notifications_overdue: "Notifications overdue",
  notification_leases_stalled: "Notification workers stalled",
  gift_cancellations_overdue: "Recurring gift cancellations overdue",
  gift_cancellation_leases_stalled: "Recurring gift cancellation workers stalled",
  account_deletions_failed: "Account deletions failed",
  account_deletions_overdue: "Account deletions overdue",
  account_deletion_leases_stalled: "Account deletion workers stalled",
  messaging_failed: "Messaging sync failed",
  messaging_overdue: "Messaging sync overdue",
  messaging_leases_stalled: "Messaging sync workers stalled",
  stream_preparation_stalled: "Live stream preparation stalled",
  health_checks_unavailable: "Operations checks unavailable",
};

type AlertCheck = { name: string; count: number | null };
export type OperationsAlertPayload = { test: boolean; checkedAt: string; checks: AlertCheck[] };
export type OperationsMonitorResult = {
  healthy: boolean;
  failedChecks: number;
  alert: "healthy" | "suppressed" | "sent" | "deferred" | "disabled";
};

/** Recipient addresses come only from the existing internal support setting. */
export function operationsAlertRecipients(): string[] {
  const configured = process.env.SUPPORT_NOTIFY_EMAIL?.trim();
  return configured
    ? [...new Set(configured.split(",").map(value => value.trim()).filter(Boolean))]
    : [SUPPORT_EMAIL];
}

function safePayload(value: unknown): OperationsAlertPayload {
  if (!value || typeof value !== "object") throw new Error("operations_alert_payload_unavailable");
  const row = value as Partial<OperationsAlertPayload>;
  const checkedAt = typeof row.checkedAt === "string" ? Date.parse(row.checkedAt) : NaN;
  if (!Number.isFinite(checkedAt) || !Array.isArray(row.checks) || row.checks.length > 25) {
    throw new Error("operations_alert_payload_unavailable");
  }
  const checks = row.checks.map(check => ({
    name: Object.hasOwn(CHECK_LABELS, check.name) ? check.name : "health_checks_unavailable",
    count: Number.isInteger(check.count) && check.count! >= 0 ? check.count : null,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { test: row.test === true, checkedAt: new Date(checkedAt).toISOString(), checks };
}

/** Send only the durable, redacted snapshot: retry bodies remain identical. */
export async function sendOperationsAlert(input: {
  payload: OperationsAlertPayload;
  deliveryKey: string;
  fetcher?: typeof fetch;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const recipients = operationsAlertRecipients();
  if (!apiKey || recipients.length === 0) return false;
  const payload = safePayload(input.payload);
  const title = payload.test ? "FaithForm operations monitoring test" : "FaithForm operations need attention";
  const content = renderEmail({
    title, preheader: title, heading: title,
    blocks: [
      { kind: "paragraph", text: payload.test
        ? "This is the requested test of FaithForm's operations alert delivery. No church data is included."
        : "A scheduled check found failed or overdue work. Review the affected queue and its worker logs." },
      { kind: "detail", label: "Checked at (UTC)", value: payload.checkedAt },
      ...payload.checks.map(check => ({ kind: "detail" as const,
        label: CHECK_LABELS[check.name], value: check.count === null ? "Check unavailable" : String(check.count) })),
    ],
    footerNote: "FaithForm operations monitoring",
    permissionNote: "You received this because you receive FaithForm's internal support notifications.",
  });
  try {
    const result = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `operations-alert/${input.deliveryKey}` },
      body: JSON.stringify({
        from: `FaithForm Support <${process.env.SUPPORT_FROM_EMAIL?.trim() || SUPPORT_EMAIL}>`,
        to: recipients, subject: title, html: content.html, text: content.text,
      }),
    });
    return result.ok;
  } catch {
    return false;
  }
}

export async function runOperationsMonitor(input: {
  test?: boolean;
  health?: OperationsHealth;
  client?: SupabaseClient;
  sender?: typeof sendOperationsAlert;
  now?: Date;
} = {}): Promise<OperationsMonitorResult> {
  const now = input.now ?? new Date();
  const health = input.test ? { ok: true, checkedAt: now.toISOString(), checks: [] }
    : input.health ?? await checkOperationsHealth(input.client ? { client: input.client } : {});
  const failedChecks = health.checks.filter(check => !check.ok);
  const payload = safePayload({ test: input.test === true, checkedAt: health.checkedAt,
    checks: failedChecks.length ? failedChecks : health.ok ? [] : [{ name: "health_checks_unavailable", count: null }] });
  const fingerprint = input.test || !health.ok
    ? createHash("sha256").update(JSON.stringify({ test: payload.test,
      checks: payload.checks.map(check => [check.name, check.count === null ? "unknown" : "failed"]) })).digest("hex")
    : null;
  const client = input.client ?? createAdminClient({ signal: AbortSignal.timeout(40_000) });
  const monitorKey = input.test ? "operations-test" : "operations-health";
  const claimToken = randomUUID();
  const { data: rows, error: claimError } = await client.rpc("claim_operations_alert", {
    p_monitor_key: monitorKey, p_fingerprint: fingerprint,
    p_payload: payload, p_claim_token: claimToken, p_repeat: input.test === true,
  });
  if (claimError?.code === "PGRST202" || claimError?.code === "42883") {
    return { healthy: health.ok, failedChecks: payload.checks.length, alert: "disabled" };
  }
  if (claimError) throw new Error("operations_alert_claim_failed");
  const resultBase = { healthy: health.ok, failedChecks: payload.checks.length };
  if (!fingerprint) return { ...resultBase, alert: "healthy" };
  const claim = rows?.[0] as { lease_token?: string; delivery_key?: string; alert_payload?: unknown } | undefined;
  if (!claim) return { ...resultBase, alert: "suppressed" };
  if (claim.lease_token !== claimToken || !claim.delivery_key) throw new Error("operations_alert_claim_invalid");
  let sent = false;
  try {
    sent = await (input.sender ?? sendOperationsAlert)({
      payload: safePayload(claim.alert_payload), deliveryKey: claim.delivery_key,
    });
  } catch {
    sent = false;
  }
  const { data: completed, error: completionError } = await client.rpc("complete_operations_alert", {
    p_monitor_key: monitorKey, p_claim_token: claimToken, p_sent: sent,
  });
  if (completionError || completed !== true) throw new Error("operations_alert_completion_failed");
  return { ...resultBase, alert: sent ? "sent" : "deferred" };
}
