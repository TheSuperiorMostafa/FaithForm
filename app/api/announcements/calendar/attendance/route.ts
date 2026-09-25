import { NextResponse } from "next/server";

import { saveEventAttendance } from "@/lib/attendance/v2/event-attendance";
import { getChurchAuth } from "@/lib/auth/church";
import { VisitorError } from "@/lib/faithform/errors";
import { featureAccessDenied } from "@/lib/features/guard";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const denied = await featureAccessDenied("attendance", supabase);
  if (denied) return denied;
  if (!auth.isAdmin) {
    return NextResponse.json(
      { error: "Only church admins can change event attendance." },
      { status: 403 },
    );
  }

  try {
    const values = await request.json();
    const settings = await saveEventAttendance({
      churchId: auth.churchId,
      churchTimezone: auth.churchTimezone,
      actorUserId: auth.userId,
      values,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof VisitorError) {
      const status = error.code === "conflict" ? 409 : error.code === "invalid_input" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[announcements] save event attendance:", error);
    return NextResponse.json(
      { error: "We couldn't save check-in for this event. Please try again." },
      { status: 500 },
    );
  }
}

