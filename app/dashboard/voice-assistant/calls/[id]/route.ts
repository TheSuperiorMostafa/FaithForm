import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Old links to one call (`/dashboard/voice-assistant/calls/<id>`) land on the
 * same call in Phone Calls.
 *
 * A route handler rather than a page, so the Voice Assistant layout (staff
 * only) cannot redirect a church member to the list first and lose the id.
 * The call page does its own sign-in, feature and church checks.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.redirect(
    new URL(`/dashboard/call-log/${encodeURIComponent(id)}`, request.url),
  );
}
