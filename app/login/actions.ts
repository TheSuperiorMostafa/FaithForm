"use server";

import { createClient } from "@/lib/supabase/server";
import {
  assertRateLimit,
} from "@/lib/security/rate-limit";
import { getRequestIpFromHeaders } from "@/lib/security/request-ip";
import { absoluteAppPath } from "@/lib/site-url";

export type LoginFormState = {
  ok: boolean;
  error?: string;
};

async function enforceLoginRateLimit(action: string): Promise<LoginFormState | null> {
  const ip = await getRequestIpFromHeaders();
  const rate = await assertRateLimit(`login:${action}:${ip}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.ok) {
    return {
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    };
  }
  return null;
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
  // absoluteAppPath treats an empty NEXT_PUBLIC_SITE_URL as unset and falls
  // back to the canonical production origin, so magic links never point at a
  // relative path (which silently breaks the redirect back to /auth/callback).
  const redirectTo = absoluteAppPath("/auth/callback");

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
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

  const redirectTo = absoluteAppPath(
    `/auth/callback?next=${encodeURIComponent("/set-password?reason=recovery")}`,
  );

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
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
