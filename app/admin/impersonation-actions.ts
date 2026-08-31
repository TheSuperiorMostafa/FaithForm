"use server";

import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  encodeImpersonationNote,
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
} from "@/lib/auth/impersonation";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Step into a church's dashboard.
 *
 * `requireSuperAdmin` runs first and redirects anyone who is not one, so the
 * note is only ever written for an account that has just proven itself. The
 * church id is checked against the table rather than trusted from the form —
 * the value arrives from a browser, and a signed note naming a church that
 * does not exist would only fail later and less clearly.
 */
export async function startImpersonation(formData: FormData) {
  const user = await requireSuperAdmin();

  const churchId = formData.get("churchId")?.toString().trim() ?? "";
  if (!churchId) throw new Error("Pick a church to open.");

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id")
    .eq("id", churchId)
    .maybeSingle();

  if (!church) throw new Error("That church could not be found.");

  const note = encodeImpersonationNote({
    churchId: church.id as string,
    adminUserId: user.id,
    exp: Math.floor(Date.now() / 1000) + IMPERSONATION_TTL_SECONDS,
  });

  if (!note) {
    throw new Error(
      "Impersonation is not configured — set IMPERSONATION_SECRET or a Supabase service key.",
    );
  }

  // Same Next 15 migration type the rest of the app uses for the cookie jar.
  const store = cookies() as unknown as UnsafeUnwrappedCookies;
  store.set(IMPERSONATION_COOKIE, note, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IMPERSONATION_TTL_SECONDS,
  });

  redirect("/dashboard");
}

/**
 * Step back out.
 *
 * Not gated on being a platform admin: clearing the note only ever removes
 * access, and someone whose rights were withdrawn mid-session must still be
 * able to drop it.
 */
export async function stopImpersonation() {
  const store = cookies() as unknown as UnsafeUnwrappedCookies;
  store.delete(IMPERSONATION_COOKIE);
  redirect("/admin");
}
