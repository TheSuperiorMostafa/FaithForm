import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = request.headers.get("x-faithform-secret");
  const expected = process.env.N8N_WEBHOOK_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // TODO: Forward payload to N8N workflow when webhook URL is configured.
  console.info("[announcements-submitted]", payload);

  return NextResponse.json({ ok: true });
}
