import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

const COOKIE_NAME = "ff_donor_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;
const SEP = ".";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionSecret(): string {
  const secret = process.env.DONOR_PORTAL_SESSION_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret === "replace-me-long-random-string") {
      throw new Error("Missing DONOR_PORTAL_SESSION_SECRET in production");
    }
    return secret;
  }
  return secret ?? "dev-donor-portal-session-secret";
}

function signSessionPayload(payloadB64: string): string {
  return createHmac("sha256", getSessionSecret()).update(payloadB64).digest("base64url");
}

function verifySignedSession(raw: string): {
  churchId: string;
  donorId: string;
  exp: number;
} | null {
  const dot = raw.indexOf(".");
  if (dot < 0) return null;

  const sig = raw.slice(0, dot);
  const payloadB64 = raw.slice(dot + 1);
  const expected = signSessionPayload(payloadB64);

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as { churchId: string; donorId: string; exp: number };

    if (!payload.churchId || !payload.donorId || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

function buildSignedSessionCookie(payload: {
  churchId: string;
  donorId: string;
  exp: number;
}): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signSessionPayload(payloadB64);
  return `${sig}.${payloadB64}`;
}

export function generatePortalToken(): string {
  return createHmac("sha256", getSessionSecret())
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex");
}

export async function createPortalMagicLink(params: {
  churchId: string;
  donorId: string;
  churchSlug: string;
}): Promise<string> {
  const admin = createAdminClient();
  const token = generatePortalToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();

  await admin.from("donor_portal_sessions").insert({
    church_id: params.churchId,
    donor_id: params.donorId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const { getCanonicalSiteUrl } = await import("@/lib/site-url");
  return `${getCanonicalSiteUrl()}/give/${params.churchSlug}/portal?token=${token}`;
}

export async function consumeMagicLinkToken(
  token: string,
  churchSlug: string,
): Promise<{ churchId: string; donorId: string } | null> {
  const admin = createAdminClient();
  const tokenHash = hashToken(token);

  const { data: session } = await admin
    .from("donor_portal_sessions")
    .select("id, church_id, donor_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;
  if (session.used_at) return null;
  if (new Date(session.expires_at as string) < new Date()) return null;

  const { data: church } = await admin
    .from("churches")
    .select("slug")
    .eq("id", session.church_id as string)
    .maybeSingle();

  if (church?.slug !== churchSlug) return null;

  await admin
    .from("donor_portal_sessions")
    .update({ used_at: new Date().toISOString() })
    .eq("id", session.id);

  const sessionPayload = {
    churchId: session.church_id as string,
    donorId: session.donor_id as string,
    exp: Date.now() + SESSION_TTL_MS,
  };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, buildSignedSessionCookie(sessionPayload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    path: `/give/${churchSlug}/portal`,
  });

  return {
    churchId: session.church_id as string,
    donorId: session.donor_id as string,
  };
}

export async function getDonorPortalSession(
  churchSlug: string,
): Promise<{ churchId: string; donorId: string } | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const payload = verifySignedSession(raw);
  if (!payload) return null;

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("slug")
    .eq("id", payload.churchId)
    .maybeSingle();

  if (church?.slug !== churchSlug) return null;

  return { churchId: payload.churchId, donorId: payload.donorId };
}

export async function clearDonorPortalSession(churchSlug: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: `/give/${churchSlug}/portal` });
}
