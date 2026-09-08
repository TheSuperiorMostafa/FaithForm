"use server";

import { createClient } from "@/lib/supabase/server";
import {
  assertRateLimit,
} from "@/lib/security/rate-limit";
import { getRequestIpFromHeaders } from "@/lib/security/request-ip";
import { dashboardEmailRedirect } from "@/lib/auth/auth-redirects";

export type LoginFormState = {
  ok: boolean;
  error?: string;
};

/**
 * Turns a provider refusal into something the person at the keyboard can act
 * on. Supabase reports its own throttling in prose that varies by endpoint and
 * version, and passing it through verbatim produced sign-in screens quoting
 * "For security purposes, you can only request this after 54 seconds."
 */
function describeAuthError(message: string): string | null {
  const text = message.toLowerCase();
  if (!/rate limit|too many|after \d+ seconds|try again/.test(text)) return null;

  const seconds = /after (\d+) seconds?/.exec(text)?.[1];
  if (seconds) {
    return `Please wait ${seconds} seconds before requesting another link.`;
  }
  if (text.includes("email rate limit")) {
    return "Too many sign-in emails have been sent from this site in the last hour. Wait an hour, or sign in with your password instead.";
  }
  return "Too many attempts just now. Wait a minute and try again.";
}

async function enforceLoginRateLimit(action: string): Promise<LoginFormState | null> {
  const ip = await getRequestIpFromHeaders();
  const rate = await assertRateLimit(`login:${action}:${ip}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (rate.ok) return null;

  // A limiter that cannot answer refuses the request, because failing open on
  // sign-in is worse. But it must not claim the person did something they did
  // not do: "too many attempts" sends them off counting their own tries, when
  // the truth is that no number of attempts would have worked.
  if (rate.reason === "unavailable") {
    console.error(`[login] ${action} refused: the rate limiter is unavailable`);
    return {
      ok: false,
      error:
        "Sign-in is temporarily unavailable. This is a problem on our side, not with your account. Please try again in a few minutes.",
    };
  }

  const minutes = Math.max(1, Math.ceil(rate.retryAfterSeconds / 60));
  return {
    ok: false,
    error: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}

export async function sendMagicLink(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const rateLimited = await enforceLoginRateLimit("magic-link");
  if (rateLimited) return rateLimited;

  const email = formData.get("email")?.toString().trim();

  if (!email) {
    return { ok: false, error: "Please enter your email address." };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  // Must resolve to an absolute URL whose origin is registered in
  // Supabase → Authentication → URL Configuration (Site URL + Redirect URLs).
  // Derived from this build's configured origin — never from the request — so
  // a dashboard link can only ever land on the dashboard's own callback.
  const redirectTo = dashboardEmailRedirect();

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    return { ok: false, error: describeAuthError(error.message) ?? error.message };
  }

  return { ok: true };
}

export type PasswordLoginState = {
  ok: boolean;
  error?: string;
};

export type PasswordResetState = {
  ok: boolean;
  error?: string;
};

/**
 * Emails a password-recovery link.
 *
 * The link signs the person in through `/auth/callback` and lands them on
 * `/set-password?reason=recovery`, the same screen teammates use for their
 * first password — one place in the product knows how to set one. The response
 * is deliberately identical whether or not the address has an account, so this
 * form cannot be used to enumerate who uses FaithForm.
 */
export async function sendPasswordReset(
  _prevState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const rateLimited = await enforceLoginRateLimit("password-reset");
  if (rateLimited) return rateLimited;

  const email = formData.get("email")?.toString().trim();

  if (!email) {
    return { ok: false, error: "Please enter your email address." };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const redirectTo = dashboardEmailRedirect("/set-password?reason=recovery");

  const supabase = createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  // "Sent" either way: a distinguishable failure would confirm whether the
  // address exists. Genuine provider outages surface in server logs, not here.
  if (error && !/user|email/i.test(error.message)) {
    return { ok: false, error: "Could not send the email. Try again shortly." };
  }

  return { ok: true };
}

export async function signInWithPassword(
  _prevState: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
  const rateLimited = await enforceLoginRateLimit("password");
  if (rateLimited) return rateLimited;

  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // A throttled sign-in and a wrong password are not the same problem, and
    // "Invalid login credentials" sends someone to reset a password that was
    // right all along.
    return { ok: false, error: describeAuthError(error.message) ?? error.message };
  }

  return { ok: true };
}
