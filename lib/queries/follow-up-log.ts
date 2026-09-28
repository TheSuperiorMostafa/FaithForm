import type { SupabaseClient } from "@supabase/supabase-js";
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
  admin: SupabaseClient | null = createAdminClientOrNull(),
): Promise<FollowUpLogSunday[]> {
  if (!admin) throw new Error("Follow-up log service is unavailable.");
  if (!Number.isSafeInteger(limitSundays) || limitSundays < 1) {
    throw new Error("Follow-up log Sunday limit is invalid.");
  }

  const bySunday = new Map<string, FollowUpLogEntry[]>();
  const seen = new Set<string>();
  const pageSize = 500;
  const maxRows = 50_000;
  let previousDate: string | null = null;
  let previousTime: string | null = null;
  let previousId: string | null = null;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await admin
      .from("attendance_follow_up_log")
      .select(
        "id, service_date, recipient_name, recipient_phone, message, status, error, sender_phone, sender_name, created_at",
      )
      .eq("church_id", churchId)
      .order("service_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error || !data) {
      throw new Error(`Follow-up log read failed: ${error?.message ?? "missing result"}`);
    }
    if (data.length > pageSize) throw new Error("Follow-up log read exceeded its page size.");

    for (const row of data as LogRow[]) {
      if (
        !row.id || seen.has(row.id) ||
        (previousDate !== null && (
          row.service_date > previousDate ||
          (row.service_date === previousDate && (
            row.created_at > previousTime! ||
            (row.created_at === previousTime && row.id >= previousId!)
          ))
        ))
      ) {
        throw new Error("Follow-up log changed while loading. Please retry.");
      }
      seen.add(row.id);
      previousDate = row.service_date;
      previousTime = row.created_at;
      previousId = row.id;

      if (!bySunday.has(row.service_date) && bySunday.size === limitSundays) {
        return summarizeSundays(bySunday);
      }
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
    if (data.length < pageSize) return summarizeSundays(bySunday);
  }
  throw new Error("Follow-up log is too large to load safely. Contact FaithForm support.");
}

function summarizeSundays(bySunday: Map<string, FollowUpLogEntry[]>): FollowUpLogSunday[] {
  return Array.from(bySunday.entries())
    .map(([serviceDate, entries]) => ({
      serviceDate,
      entries,
      sentCount: entries.filter((e) => e.status === "sent").length,
      failedCount: entries.filter((e) => e.status !== "sent").length,
    }));
}
