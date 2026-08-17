import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type FollowUpLogStatus = "sent" | "failed" | "skipped";

export type FollowUpLogEntry = {
  id: string;
  serviceDate: string;
  recipientName: string;
  recipientPhone: string | null;
  message: string;
  status: FollowUpLogStatus;
  error: string | null;
  senderPhone: string | null;
  senderName: string | null;
  sentAt: string;
};

export type FollowUpLogSunday = {
  serviceDate: string;
  entries: FollowUpLogEntry[];
  sentCount: number;
  failedCount: number;
};

type LogRow = {
  id: string;
  service_date: string;
  recipient_name: string;
  recipient_phone: string | null;
  message: string;
  status: string;
  error: string | null;
  sender_phone: string | null;
  sender_name: string | null;
  created_at: string;
};

function toStatus(value: string): FollowUpLogStatus {
  return value === "failed" || value === "skipped" ? value : "sent";
}

/**
 * Every follow-up text a church has sent, newest Sunday first and grouped by
 * the Sunday it belongs to.
 *
 * Reads through the service role: the log holds phone numbers and message
 * bodies, so callers must have already established that the requester belongs
 * to `churchId`.
 */
export async function getFollowUpLog(
  churchId: string,
  limitSundays = 12,
): Promise<FollowUpLogSunday[]> {
  const admin = createAdminClientOrNull();
  if (!admin) {
    console.error("getFollowUpLog: service role key is not configured");
    return [];
  }

  const { data, error } = await admin
    .from("attendance_follow_up_log")
    .select(
      "id, service_date, recipient_name, recipient_phone, message, status, error, sender_phone, sender_name, created_at",
    )
    .eq("church_id", churchId)
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    // A database that has not had migration 0046 applied yet simply has no log
    // to show — that is an empty page, not a broken one.
    if (!/attendance_follow_up_log/i.test(error.message)) {
      console.error("getFollowUpLog:", error.message);
    }
    return [];
  }

  const bySunday = new Map<string, FollowUpLogEntry[]>();
  for (const row of (data ?? []) as LogRow[]) {
    const entry: FollowUpLogEntry = {
      id: row.id,
      serviceDate: row.service_date,
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      message: row.message,
      status: toStatus(row.status),
      error: row.error,
      senderPhone: row.sender_phone,
      senderName: row.sender_name,
      sentAt: row.created_at,
    };
    const existing = bySunday.get(row.service_date);
    if (existing) existing.push(entry);
    else bySunday.set(row.service_date, [entry]);
  }

  return Array.from(bySunday.entries())
    .slice(0, limitSundays)
    .map(([serviceDate, entries]) => ({
      serviceDate,
      entries,
      sentCount: entries.filter((e) => e.status === "sent").length,
      failedCount: entries.filter((e) => e.status !== "sent").length,
    }));
}
