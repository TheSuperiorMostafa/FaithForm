import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import { cache } from "react";

import { createAdminClientOrNull } from "@/lib/supabase/admin";

/**
 * Letting a platform admin work inside one church's dashboard.
 *
 * The Supabase session is never swapped. Signing a platform admin in as
 * somebody else would mean minting a token for an account we do not own, and
 * would leave an audit trail attributing our actions to a church's own staff.
 * Instead the admin stays themselves and carries a short-lived, signed note
 * saying which church they are currently acting inside; `getChurchAuth` reads
 * that note and hands back that church's context.
 *
 * Two separate checks stand behind it, and they answer different questions:
 *
 *   - The signature and expiry, verified synchronously, gate *data access* —
 *     `createClient()` reads through the service role while a valid note is
 *     present, because a platform admin has no `church_users` row and RLS would
 *     otherwise return an empty dashboard.
 *   - Live platform-admin membership, verified against the database on every
 *     request, gates *the interface*. A revoked admin stops being handed a
 *     church context even while their cookie is still in date.
 *
 * The note is signed with a server-only secret, so forging one requires a
 * credential that already grants everything the note does. It is httpOnly, it
 * expires on its own, and it is cleared on sign-out.
 */

export const IMPERSONATION_COOKIE = "faithform:acting-as";

/** Short on purpose: the window a withdrawn admin keeps data access. */
export const IMPERSONATION_TTL_SECONDS = 30 * 60;

export type ImpersonationNote = {
  churchId: string;
  adminUserId: string;
  /** Unix seconds. */
  exp: number;
};

function signingSecret(): string | null {
  return (
    process.env.IMPERSONATION_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null
  );
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payload).digest());
}

export function encodeImpersonationNote(note: ImpersonationNote): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  const payload = base64url(JSON.stringify(note));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Signature and expiry only. Says the note is ours and still in date — not
 * that the person carrying it is still allowed to use it.
 */
export function decodeImpersonationNote(
  value: string | undefined,
): ImpersonationNote | null {
  if (!value) return null;

  const secret = signingSecret();
  if (!secret) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const note = JSON.parse(fromBase64url(payload).toString("utf8")) as
      | ImpersonationNote
      | null;
    if (
      !note ||
      typeof note.churchId !== "string" ||
      typeof note.adminUserId !== "string" ||
      typeof note.exp !== "number"
    ) {
      return null;
    }
    if (note.exp * 1000 <= Date.now()) return null;
    return note;
  } catch {
    return null;
  }
}

/**
 * The note on this request, signature-checked but not authorized.
 *
 * Synchronous because `createClient()` is, and it needs an answer before it can
 * decide which credential to read through.
 */
export function readImpersonationNote(): ImpersonationNote | null {
  try {
    const store = cookies() as unknown as UnsafeUnwrappedCookies;
    return decodeImpersonationNote(store.get(IMPERSONATION_COOKIE)?.value);
  } catch {
    // Outside a request scope (a build-time render, a background job) there is
    // no cookie jar and there is no impersonation either.
    return null;
  }
}

export type ActiveImpersonation = {
  churchId: string;
  adminUserId: string;
  adminEmail: string | null;
  churchName: string | null;
};

/**
 * The authorized answer: a note whose bearer is, right now, the platform admin
 * it names. Every step is re-checked against the database, so revoking someone
 * in `platform_admins` takes their church context away on the next request.
 *
 * Deliberately does not call `requireSuperAdmin`, which redirects — this is
 * asked in places (the dashboard layout, feature gates) where the answer "no"
 * must mean "carry on as an ordinary user", not "navigate away".
 */
async function resolveActiveImpersonation(): Promise<ActiveImpersonation | null> {
  const note = readImpersonationNote();
  if (!note) return null;

  const admin = createAdminClientOrNull();
  if (!admin) return null;

  // The session, not the note, decides who is asking. A note lifted into
  // another browser is useless without that person's own signed-in session.
  const { createClient: createSessionClient } = await import(
    "@/lib/supabase/server"
  );
  const { data: claims } = await createSessionClient().auth.getClaims();
  const sessionUserId =
    typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;

  if (!sessionUserId || sessionUserId !== note.adminUserId) return null;

  const { isPlatformAdminUserId } = await import("@/lib/auth/superadmin");
  if (!(await isPlatformAdminUserId(note.adminUserId))) return null;

  const { data: church } = await admin
    .from("churches")
    .select("id, name")
    .eq("id", note.churchId)
    .maybeSingle();

  if (!church) return null;

  return {
    churchId: church.id as string,
    adminUserId: note.adminUserId,
    adminEmail:
      typeof claims?.claims?.email === "string" ? claims.claims.email : null,
    churchName: (church.name as string | null) ?? null,
  };
}

/** One authorization round trip per request, however many callers ask. */
export const getActiveImpersonation = cache(resolveActiveImpersonation);
