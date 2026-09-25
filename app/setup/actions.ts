"use server";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/temp-password";
import { generateChurchSlug } from "@/lib/churches/slug";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { getRequestIpFromHeaders } from "@/lib/security/request-ip";
import { dashboardEmailRedirect } from "@/lib/auth/auth-redirects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ALREADY_REGISTERED_MESSAGE,
  isAlreadyRegistered,
  signUpErrorMessage,
} from "@/app/login/auth-messages";

/**
 * Self-serve church setup.
 *
 * A pastor stands their own church up without waiting for anyone at FaithForm.
 * The pieces are the ones the invite flow already uses — the same
 * service-role insert into `churches` and the same `church_users` admin link
 * that `completeOnboarding` writes — so nothing here creates a second way of
 * being a church. RLS is untouched: `churches` still has no INSERT policy for
 * browsers, and the membership row is still minted server-side only.
 *
 * The account is Supabase Auth and stays church-agnostic. What ties the person
 * to the church is the `church_users` row this action creates, exactly one,
 * with role `admin` — the role that owns team management, visitor invitations,
 * and join-request approval in the existing dashboard.
 */

export type SetupAccountState = {
  ok: boolean;
  /** Signup succeeded but the project requires email confirmation first. */
  needsEmailConfirmation?: boolean;
  /** The email already has an account and the password did not open it. */
  existingAccount?: boolean;
  error?: string;
};

export type SetupChurchState = {
  ok: boolean;
  error?: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function enforceSetupRateLimit(
  action: string,
  limit: number,
): Promise<string | null> {
  const ip = await getRequestIpFromHeaders();
  const rate = await assertRateLimit(`setup:${action}:${ip}`, {
    limit,
    windowMs: 15 * 60 * 1000,
  });
  return rate.ok
    ? null
    : "Too many attempts. Please wait a few minutes and try again.";
}

function isUsableTimezone(timezone: string): boolean {
  try {
    // Throws on anything the runtime does not recognise as an IANA zone —
    // the same rule the database trigger enforces on campuses later.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function createSetupAccount(
  _prev: SetupAccountState,
  formData: FormData,
): Promise<SetupAccountState> {
  const limited = await enforceSetupRateLimit("account", 10);
  if (limited) return { ok: false, error: limited };

  const firstName = formData.get("firstName")?.toString().trim() ?? "";
  const lastName = formData.get("lastName")?.toString().trim() ?? "";
  const email = formData.get("email")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  // Optional here: the one-screen form sends it so an email confirmation that
  // is opened later (or on another device) can bring the name back. It is
  // only ever used to prefill the church-name box; the church itself is still
  // created by `createChurchForCurrentUser`, which validates it again.
  const pendingChurchName = (formData.get("name")?.toString().trim() ?? "").slice(0, 120);

  if (!firstName) return { ok: false, error: "Please enter your first name." };
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const supabase = createClient();
  const emailRedirectTo = dashboardEmailRedirect("/setup");

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        ...(pendingChurchName ? { pending_church_name: pendingChurchName } : {}),
      },
      emailRedirectTo,
    },
  });

  if (signUpError) {
    if (isAlreadyRegistered(signUpError)) {
      // The same person coming back, most likely. Their password either works
      // — carry on — or it does not, and the honest answer names both doors.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        return { ok: false, existingAccount: true, error: ALREADY_REGISTERED_MESSAGE };
      }
      return { ok: true };
    }
    console.error("[setup] sign-up refused:", signUpError.message);
    return { ok: false, error: signUpErrorMessage(signUpError, MIN_PASSWORD_LENGTH) };
  }

  // With email confirmation switched on, Supabase returns the user without a
  // session. Saying "check your email" is the only truthful next step.
  if (!data.session) {
    return { ok: true, needsEmailConfirmation: true };
  }

  return { ok: true };
}

export async function createChurchForCurrentUser(
  _prev: SetupChurchState,
  formData: FormData,
): Promise<SetupChurchState> {
  const limited = await enforceSetupRateLimit("church", 5);
  if (limited) return { ok: false, error: limited };

  const name = formData.get("name")?.toString().trim() ?? "";
  const timezone =
    formData.get("timezone")?.toString().trim() || "America/New_York";

  if (!name) return { ok: false, error: "Please enter your church's name." };
  if (name.length > 120) {
    return { ok: false, error: "Church name must be 120 characters or fewer." };
  }
  if (!isUsableTimezone(timezone)) {
    return { ok: false, error: "Choose your time zone from the list." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Sign in or create your account first." };
  }

  const admin = createAdminClient();

  // One person, one church — the invariant the rest of the dashboard already
  // assumes (`getChurchAuth` resolves exactly one membership, and team
  // management refuses cross-church adds). Checked with the service role so an
  // RLS quirk cannot make an existing membership invisible here.
  const { data: existing, error: existingError } = await admin
    .from("church_users")
    .select("church_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: "We couldn't check your account just now. Please try again." };
  }
  if (existing) {
    return {
      ok: false,
      error:
        "Your account already belongs to a church. Sign in to open its dashboard.",
    };
  }

  const now = new Date().toISOString();

  const { data: church, error: churchError } = await admin
    .from("churches")
    .insert({
      name,
      timezone,
      slug: generateChurchSlug(name),
      // Self-serve setup has no pending invite to redeem, so the church is
      // born onboarded; everything else is configured from the dashboard.
      onboarding_completed_at: now,
    })
    .select("id")
    .single();

  if (churchError || !church) {
    return { ok: false, error: "We couldn't create your church. Please try again." };
  }

  const { error: linkError } = await admin.from("church_users").insert({
    church_id: church.id,
    user_id: user.id,
    role: "admin",
    onboarding_step: "completed",
  });

  if (linkError) {
    // A church without its admin is an orphan nobody can reach; undo it so a
    // retry starts clean instead of tripping over a half-made workspace.
    await admin.from("churches").delete().eq("id", church.id);
    return { ok: false, error: "We couldn't finish setting up your church. Please try again." };
  }

  return { ok: true };
}
