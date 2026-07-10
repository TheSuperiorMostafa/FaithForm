import { NextResponse } from "next/server";
import { listChatMessages } from "@/lib/stream/chat";

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("eventId")?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const messages = await listChatMessages(eventId);
  return NextResponse.json({ messages });
}
