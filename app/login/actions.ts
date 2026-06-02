"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type LoginFormState = {
  ok: boolean;
  error?: string;
};

export async function sendMagicLink(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = formData.get("email")?.toString().trim();

  if (!email) {
    return { ok: false, error: "Please enter your email address." };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  // Must match Supabase → Authentication → URL Configuration (Site URL + Redirect URLs).
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
      : undefined);
  const headersList = headers();
  const origin = siteUrl ?? headersList.get("origin") ?? "http://localhost:3000";
  const redirectTo = `${origin}/auth/callback`;

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

export async function signInWithPassword(
  _prevState: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
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
