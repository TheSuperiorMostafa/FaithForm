import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The call log moved out of Voice Assistant and became Phone Calls.
 *
 * A route handler rather than a page: pages here render inside the Voice
 * Assistant layout, which sends everyone but FaithForm staff to the log before
 * the page runs. Phone Calls does its own sign-in and feature checks.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/dashboard/call-log", request.url));
}
