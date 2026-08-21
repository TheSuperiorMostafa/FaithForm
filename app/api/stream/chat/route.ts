import { NextResponse } from "next/server";
import { listChatMessages } from "@/lib/stream/chat";
import { getChurchBySlug } from "@/lib/queries/giving";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId")?.trim();
  const slug = url.searchParams.get("slug")?.trim();
  if (!eventId || !slug || eventId.length > 64 || slug.length > 100) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const church = await getChurchBySlug(slug);
  if (!church) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("stream_events")
    .select("id")
    .eq("id", eventId)
    .eq("church_id", church.churchId)
    .eq("status", "live")
    .eq("chat_enabled", true)
    .eq("public_access", true)
    .maybeSingle();
  if (!event?.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await listChatMessages(eventId, church.churchId, admin);
  return NextResponse.json(
    { messages },
    { headers: { "Cache-Control": "no-store" } },
  );
}
