import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { dispatchStaffNotifications, queueAttendanceDocumentNotifications } from "@/lib/notifications/staff";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!compareSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await queueAttendanceDocumentNotifications();
    return NextResponse.json({ ok: true, ...await dispatchStaffNotifications() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Notifications could not be processed." }, { status: 503 }); }
}
