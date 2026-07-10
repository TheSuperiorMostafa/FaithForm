import { NextResponse } from "next/server";

import { compareSecret } from "@/lib/security/compare-secret";

/** Legacy webhook — attendance SMS is sent directly from submitAttendance. */
export async function POST(request: Request) {
  const secret = request.headers.get("x-faithform-secret");
  const expected = process.env.N8N_WEBHOOK_SECRET;

  if (!compareSecret(secret, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
