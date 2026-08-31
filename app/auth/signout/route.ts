import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import { NextResponse } from "next/server";

import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();

  // The impersonation note is bound to the session that was just ended, so it
  // is already inert — but leaving a stale one in the jar means the next
  // sign-in on this browser reads through the service role until it expires.
  const store = cookies() as unknown as UnsafeUnwrappedCookies;
  store.delete(IMPERSONATION_COOKIE);

  return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"), {
    status: 302,
  });
}
