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

  console.info("[attendance-submitted]", payload);

  const n8nUrl = process.env.N8N_ATTENDANCE_WEBHOOK_URL;

  if (n8nUrl) {
    try {
      const forwardRes = await fetch(n8nUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-faithform-secret": expected,
        },
        body: JSON.stringify(payload),
      });

      if (!forwardRes.ok) {
        const body = await forwardRes.text();
        console.error(
          "[attendance-submitted] n8n forward failed:",
          forwardRes.status,
          body,
        );
      }
    } catch (forwardError) {
      console.error("[attendance-submitted] n8n forward error:", forwardError);
    }
  } else {
    console.warn(
      "[attendance-submitted] N8N_ATTENDANCE_WEBHOOK_URL is not set — follow-up SMS will not run.",
    );
  }

  return NextResponse.json({ ok: true });
}
