import { NextResponse } from "next/server";
import { sessionCameFromRecovery } from "@/lib/auth/recovery";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security/safe-redirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // A reset link must land on the reset screen even when the `next`
      // instruction was stripped — Supabase falls back to the bare Site URL
      // for any redirect not on its allow-list. The session's own `amr`
      // claim says how it was minted, so the token is the source of truth
      // rather than a query parameter that may not have survived.
      if (sessionCameFromRecovery(data.session?.access_token)) {
        return NextResponse.redirect(`${origin}/set-password?reason=recovery`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
