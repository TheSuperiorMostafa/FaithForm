import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { dispatchStaffNotifications, queueAttendanceDocumentNotifications } from "@/lib/notifications/staff";
import { creditAttendanceReports } from "@/lib/activity/attendance-report-credits";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!compareSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Time-saved credits must never hold up notifications.
  await creditAttendanceReports().catch(() => console.error("[attendance reports] Could not credit reports."));
  try {
    await queueAttendanceDocumentNotifications();
    return NextResponse.json({ ok: true, ...await dispatchStaffNotifications() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Notifications could not be processed." }, { status: 503 }); }
}
