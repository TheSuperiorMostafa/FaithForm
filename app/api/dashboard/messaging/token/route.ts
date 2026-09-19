import { NextResponse } from "next/server";

import { getChurchAuth } from "@/lib/auth/church";
import { VisitorError } from "@/lib/faithform/errors";
import { featureAccessDenied } from "@/lib/features/guard";
import { issueStaffChatSession } from "@/lib/messaging/session";

/**
 * A chat credential for a signed-in staff member, for the dashboard's group
 * conversations. The browser's chat client calls this as its token provider.
 *
 * The token names the staff member's own chat identity, whose reach is their
 * church's group conversations (as a team-scoped staff role) and never direct
 * messages. POST, same-origin cookies only, never cached.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await featureAccessDenied("groups");
  if (denied) return denied;
  const auth = await getChurchAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const session = await issueStaffChatSession(auth);
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof VisitorError) {
      const status = error.code === "forbidden" ? 403 : error.code === "unavailable" ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[messaging] staff session failed");
    return NextResponse.json({ error: "Messages are unavailable right now." }, { status: 503 });
  }
}
