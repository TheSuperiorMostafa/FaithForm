import { NextResponse } from "next/server";
import { z } from "zod";
import { clearDonorPortalSession } from "@/lib/giving/portal-session";

const bodySchema = z.object({
  slug: z.string().min(1),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await clearDonorPortalSession(parsed.data.slug);

  return NextResponse.json({ ok: true });
}
