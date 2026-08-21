import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

const COOKIE_NAME = "ff_donor_portal_v2";
const LEGACY_COOKIE_NAME = "ff_donor_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;

type SignedPortalSession = {
  version: 2;
  sessionId: string;
  churchId: string;
  donorId: string;
  exp: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionSecret(): string {
  const secret = process.env.DONOR_PORTAL_SESSION_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 32 || secret.startsWith("replace-me")) {
      throw new Error("Donor portal authentication is unavailable.");
    }
    return secret;
  }
  return secret || "dev-only-donor-portal-session-secret";
}

function signSessionPayload(payloadB64: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("base64url");
}

export function verifySignedPortalSession(
  raw: string,
  nowMs = Date.now(),
): SignedPortalSession | null {
  const [payloadB64, signature, extra] = raw.split(".");
  if (!payloadB64 || !signature || extra) return null;

  const expected = signSessionPayload(payloadB64);
  try {
    const actualBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as Partial<SignedPortalSession>;
    if (
      payload.version !== 2 ||
      !payload.sessionId ||
      !payload.churchId ||
      !payload.donorId ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowMs
    ) {
      return null;
    }
    return payload as SignedPortalSession;
  } catch {
    return null;
  }
}

export function buildSignedPortalSession(
  payload: SignedPortalSession,
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${signSessionPayload(payloadB64)}`;
}

export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createPortalMagicLink(params: {
  churchId: string;
  donorId: string;
  churchSlug: string;
}): Promise<string> {
  const admin = createAdminClient();
  const token = generatePortalToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();

  const { error } = await admin.from("donor_portal_sessions").insert({
    church_id: params.churchId,
    donor_id: params.donorId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  });
  if (error) throw new Error("Could not create donor sign-in link.");

  const { getCanonicalSiteUrl } = await import("@/lib/site-url");
  const site = getCanonicalSiteUrl().replace(/\/$/, "");
  return `${site}/api/give/portal/auth?slug=${encodeURIComponent(params.churchSlug)}&token=${encodeURIComponent(token)}`;
}

export async function consumeMagicLinkToken(
  token: string,
  churchSlug: string,
): Promise<{ churchId: string; donorId: string } | null> {
  if (token.length < 32 || token.length > 256 || churchSlug.length > 100) {
    return null;
  }

  const admin = createAdminClient();
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { data, error } = await admin.rpc("consume_donor_portal_token", {
    p_token_hash: hashToken(token),
    p_church_slug: churchSlug,
    p_session_expires_at: sessionExpiresAt.toISOString(),
  });

  if (error) throw new Error("Could not verify donor sign-in link.");
  const claimed = data?.[0] as
    | { session_id: string; church_id: string; donor_id: string }
    | undefined;
  if (!claimed) return null;

  const payload: SignedPortalSession = {
    version: 2,
    sessionId: claimed.session_id,
    churchId: claimed.church_id,
    donorId: claimed.donor_id,
    exp: sessionExpiresAt.getTime(),
  };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, buildSignedPortalSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });

  return { churchId: claimed.church_id, donorId: claimed.donor_id };
}

export async function getDonorPortalSession(
  churchSlug: string,
): Promise<{ churchId: string; donorId: string; sessionId: string } | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const payload = verifySignedPortalSession(raw);
  if (!payload) return null;

  const admin = createAdminClient();
  const { data: session, error } = await admin
    .from("donor_portal_sessions")
    .select("id, church_id, donor_id, session_expires_at, revoked_at, used_at")
    .eq("id", payload.sessionId)
    .eq("church_id", payload.churchId)
    .eq("donor_id", payload.donorId)
    .maybeSingle();

  if (
    error ||
    !session ||
    !session.used_at ||
    session.revoked_at ||
    !session.session_expires_at ||
    Date.parse(session.session_expires_at as string) <= Date.now()
  ) {
    return null;
  }

  const [{ data: church }, { data: donor }] = await Promise.all([
    admin
      .from("churches")
      .select("id")
      .eq("id", payload.churchId)
      .eq("slug", churchSlug)
      .maybeSingle(),
    admin
      .from("giving_donors")
      .select("id")
      .eq("id", payload.donorId)
      .eq("church_id", payload.churchId)
      .is("portal_access_revoked_at", null)
      .maybeSingle(),
  ]);

  if (!church?.id || !donor?.id) return null;
  return {
    churchId: payload.churchId,
    donorId: payload.donorId,
    sessionId: payload.sessionId,
  };
}

export async function clearDonorPortalSession(churchSlug: string): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const payload = raw ? verifySignedPortalSession(raw) : null;

  if (payload) {
    const admin = createAdminClient();
    await admin
      .from("donor_portal_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", payload.sessionId)
      .eq("church_id", payload.churchId)
      .eq("donor_id", payload.donorId);
  }

  cookieStore.delete({ name: COOKIE_NAME, path: "/" });
  cookieStore.delete({
    name: LEGACY_COOKIE_NAME,
    path: `/give/${churchSlug}/portal`,
  });
}
