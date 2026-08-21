import type { SupabaseClient } from "@supabase/supabase-js";
import { sendDonationReceiptEmail } from "@/lib/email/giving";
import { createAdminClient } from "@/lib/supabase/admin";

function fundName(
  value: { name?: string } | { name?: string }[] | null | undefined,
): string | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0]?.name : value.name) ?? null;
}

export async function deliverDonationReceipt(
  donationId: string,
  client: SupabaseClient = createAdminClient(),
): Promise<"sent" | "deferred" | "skipped"> {
  const { data: claimRows, error: claimError } = await client.rpc(
    "claim_donation_receipt",
    { p_donation_id: donationId, p_lease_seconds: 300 },
  );
  if (claimError) throw new Error("receipt_claim_failed");
  const claim = claimRows?.[0] as
    | { claimed: boolean; claim_token: string | null; attempt: number }
    | undefined;
  if (!claim?.claimed || !claim.claim_token) return "skipped";

  const { data: donation } = await client
    .from("giving_donations")
    .select(
      "id, church_id, donor_email, donor_name, amount_cents, intended_amount_cents, gift_type, created_at, giving_funds(name)",
    )
    .eq("id", donationId)
    .eq("status", "succeeded")
    .maybeSingle();

  const { data: church } = donation?.church_id
    ? await client
        .from("churches")
        .select("name, slug, ein, giving_primary_color, giving_accent_color")
        .eq("id", donation.church_id)
        .maybeSingle()
    : { data: null };

  let sent = false;
  if (donation?.donor_email && church?.name && church.slug) {
    try {
      const result = await sendDonationReceiptEmail({
        donorEmail: donation.donor_email as string,
        donorName: (donation.donor_name as string | null) ?? null,
        churchName: church.name as string,
        churchSlug: church.slug as string,
        ein: (church.ein as string | null) ?? null,
        amountCents:
          (donation.intended_amount_cents as number | null) ??
          (donation.amount_cents as number),
        fundName: fundName(
          donation.giving_funds as
            | { name?: string }
            | { name?: string }[]
            | null,
        ),
        giftType:
          donation.gift_type === "recurring" ? "recurring" : "one_time",
        giftDate: new Date(donation.created_at as string).toLocaleDateString(
          "en-US",
          { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
        ),
        primaryColor: (church.giving_primary_color as string | null) ?? null,
        accentColor: (church.giving_accent_color as string | null) ?? null,
        idempotencyKey: `donation-receipt/${donationId}`,
      });
      sent = result.sent;
    } catch {
      sent = false;
    }
  }

  const terminal = claim.attempt >= 12;
  const nextRetryAt = sent
    ? null
    : new Date(
        Date.now() + Math.min(5 * 60_000 * 2 ** Math.max(0, claim.attempt - 1), 24 * 60 * 60_000),
      ).toISOString();
  const { error: completionError } = await client.rpc(
    "complete_donation_receipt",
    {
      p_donation_id: donationId,
      p_claim_token: claim.claim_token,
      p_sent: sent,
      p_error_code: sent ? null : "delivery_failed",
      p_next_retry_at: nextRetryAt,
      p_terminal: terminal && !sent,
    },
  );
  if (completionError) throw new Error("receipt_completion_failed");
  return sent ? "sent" : "deferred";
}

export async function retryPendingDonationReceipts(limit = 25): Promise<{
  attempted: number;
  sent: number;
}> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("giving_donations")
    .select("id")
    .eq("status", "succeeded")
    .in("receipt_delivery_status", ["pending", "retryable", "sending"])
    .or(`receipt_next_retry_at.is.null,receipt_next_retry_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error("receipt_retry_query_failed");

  let sent = 0;
  for (const row of data ?? []) {
    if ((await deliverDonationReceipt(row.id as string, admin)) === "sent") sent += 1;
  }
  return { attempted: data?.length ?? 0, sent };
}
