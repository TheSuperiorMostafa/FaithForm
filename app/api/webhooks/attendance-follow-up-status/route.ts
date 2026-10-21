import { NextResponse } from "next/server";
import { reconcileAttendanceTexts } from "@/lib/attendance/sms-delivery";

import { compareSecret } from "@/lib/security/compare-secret";
import { createAdminClient } from "@/lib/supabase/admin";

type FollowUpStatusUpdate = {
  entryId: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
};

export async function POST(request: Request) {
  const secret = request.headers.get("x-faithform-secret");
  const expected = process.env.N8N_WEBHOOK_SECRET;

  if (!compareSecret(secret, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { updates?: FollowUpStatusUpdate[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates = body.updates ?? [];

  if (updates.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const admin = createAdminClient();
  let updated = 0;

  for (const update of updates) {
    if (!update.entryId) continue;

    const { data: entry } = await admin
      .from("attendance_entries")
      .select("id, church_id")
      .eq("id", update.entryId)
      .maybeSingle();

    if (!entry?.id) continue;

    if (update.status === "sent") {
      await admin
        .from("attendance_entries")
        .update({
          follow_up_sent_at: new Date().toISOString(),
          follow_up_error: null,
        })
        .eq("id", update.entryId)
        .eq("church_id", entry.church_id as string);
    } else if (update.status === "failed" || update.status === "skipped") {
      await admin
        .from("attendance_entries")
        .update({
          follow_up_error:
            update.error ??
            (update.status === "skipped"
              ? "No phone number on file"
              : "SMS delivery failed"),
        })
        .eq("id", update.entryId)
        .eq("church_id", entry.church_id as string);
    }

    updated += 1;
  }

  return NextResponse.json({ ok: true, updated });
}


/** Scheduled reference-based status reconciliation; no phone/message data leaves this endpoint. */
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(token, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("attendance_follow_up_log").select("church_id")
    .eq("status", "queued").not("sms_id", "is", null)
    .order("delivery_checked_at", { ascending: true, nullsFirst: true }).limit(100);
  if (error) return NextResponse.json({ error: "Text delivery tracking unavailable" }, { status: 503 });
  const churchIds = Array.from(new Set((data ?? []).map((row) => row.church_id as string))).slice(0, 4);
  const results = await Promise.allSettled(churchIds.map((id) => reconcileAttendanceTexts(admin, id)));
  return NextResponse.json({
    ok: true,
    checked: results.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value.checked : 0), 0),
    confirmed: results.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value.confirmed : 0), 0),
    failed: results.filter((result) => result.status === "rejected").length,
  }, { headers: { "Cache-Control": "no-store" } });
}
