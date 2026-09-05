import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mintCapability,
  packUuid,
  unpackUuid,
  verifyCapability,
} from "@/lib/attendance/v2/signing";
import { createAdminClient } from "@/lib/supabase/admin";
import { serviceWeekStart } from "@/lib/checkin/service-week";

/**
 * The two things a parent can present at a checkout desk.
 *
 * **The QR code is a signed token, not a row.** It carries the household it
 * speaks for and the instant it stops meaning anything, signed under its own
 * sub-key (`household.pickup`). There is no table of live QR codes to leak, no
 * lookup to do, and a screenshot taken last Sunday is refused by arithmetic
 * rather than by a revocation list somebody has to remember to write to.
 *
 * **The six-digit code is a row**, because six digits collide. Two households
 * drawing 418302 in the same week would hand a volunteer a match that names
 * two families, and the only honest way to prevent that is a unique index and
 * a retry — which is exactly what `issueWeeklyCode` does. It is stored in
 * plaintext for the unavoidable reason that a parent has to be able to read it
 * off their phone and say it out loud.
 *
 * Neither credential releases anybody on its own. Both resolve to "these are
 * the children this person may collect"; a staff member still confirms.
 *
 * Nothing in this file is ever logged. A code in a log line is a code that has
 * escaped the week it was scoped to.
 */

const CODE_TTL_DAYS = 7;

export type PickupCredential = {
  householdId: string;
  churchId: string;
  weekStart: string;
  /** Unix seconds. */
  expiresAt: number;
};

type QrBody = {
  v: number;
  h: string;
  c: string;
  w: string;
  e: number;
};

/**
 * A QR payload for one household, good until the end of its service week.
 *
 * The rotation counter is folded in so that bumping it on a
 * household — a lost phone, a custody change — produces a token that no longer
 * matches the one already on the old device.
 */
export function mintPickupQr(input: {
  householdId: string;
  churchId: string;
  weekStart: string;
  codeRotation: number;
  expiresAt: Date;
}): string | null {
  const household = packUuid(input.householdId);
  const church = packUuid(input.churchId);
  if (!household || !church) return null;

  return mintCapability("household.pickup", {
    v: 1,
    h: household,
    c: church,
    // The week and rotation together are what a stale token fails on, before
    // any database read happens.
    w: `${input.weekStart}#${input.codeRotation}`,
    e: Math.floor(input.expiresAt.getTime() / 1000),
  });
}

export type PickupQrVerification =
  | { ok: true; credential: PickupCredential; codeRotation: number }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Signature, then expiry, then contents — in that order, and nothing inside
 * the payload is trusted before the signature over it has been proven.
 */
export function verifyPickupQr(
  token: string | null | undefined,
): PickupQrVerification {
  const verified = verifyCapability<QrBody>("household.pickup", token);
  if (!verified.ok) return { ok: false, reason: "invalid" };

  const body = verified.body;
  if (typeof body.e !== "number") return { ok: false, reason: "invalid" };
  if (body.e <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  const householdId = unpackUuid(String(body.h ?? ""));
  const churchId = unpackUuid(String(body.c ?? ""));
  if (!householdId || !churchId) return { ok: false, reason: "invalid" };

  const [weekStart, rotation] = String(body.w ?? "").split("#");
  if (!weekStart) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    credential: { householdId, churchId, weekStart, expiresAt: body.e },
    codeRotation: Number(rotation ?? 0),
  };
}

/** Midnight after the Saturday that ends this service week, church-local-ish. */
export function weekExpiry(weekStart: string): Date {
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + CODE_TTL_DAYS);
  return end;
}

function randomSixDigits(): string {
  // `randomInt` over the full range rather than six independent digits: the
  // latter is the classic way to end up with a biased leading digit.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * This household's code for this week, minting one if it has none.
 *
 * The unique index on `(church_id, week_start, code)` is the authority. A
 * collision surfaces as a constraint violation and is retried, rather than
 * being pre-checked with a select — which would be a race with every other
 * household being issued a code at the same moment on a Sunday morning.
 */
export async function issueWeeklyCode(
  input: { churchId: string; householdId: string; weekStart: string },
  client?: SupabaseClient,
): Promise<string | null> {
  const admin = client ?? createAdminClient();

  const { data: existing } = await admin
    .from("household_checkout_codes")
    .select("code")
    .eq("household_id", input.householdId)
    .eq("week_start", input.weekStart)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing?.code) return existing.code as string;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomSixDigits();
    const { data, error } = await admin
      .from("household_checkout_codes")
      .insert({
        church_id: input.churchId,
        household_id: input.householdId,
        week_start: input.weekStart,
        code,
      })
      .select("code")
      .single();

    if (!error && data) return data.code as string;
    if (!error) break;

    // 23505 is a unique violation. Either this household raced itself — in
    // which case the row that won is the answer — or the code collided with
    // another household's and a different one has to be drawn.
    if (error.code !== "23505") return null;

    const { data: raced } = await admin
      .from("household_checkout_codes")
      .select("code")
      .eq("household_id", input.householdId)
      .eq("week_start", input.weekStart)
      .is("revoked_at", null)
      .maybeSingle();

    if (raced?.code) return raced.code as string;
  }

  return null;
}

export type CodeLookup =
  | { ok: true; householdId: string; weekStart: string }
  | { ok: false; reason: "not_found" | "expired" };

/**
 * Which household a staff member just typed a code for.
 *
 * Scoped to the current week and to this church, so last week's code — the one
 * still sitting in a screenshot on a parent's phone — resolves to nothing
 * rather than to whoever holds it now.
 */
export async function lookupWeeklyCode(
  input: { churchId: string; timezone: string; code: string },
  client?: SupabaseClient,
): Promise<CodeLookup> {
  const code = input.code.replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, reason: "not_found" };

  const admin = client ?? createAdminClient();
  const weekStart = serviceWeekStart(input.timezone);

  const { data } = await admin
    .from("household_checkout_codes")
    .select("household_id, week_start")
    .eq("church_id", input.churchId)
    .eq("code", code)
    .is("revoked_at", null)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { ok: false, reason: "not_found" };

  // A code from a previous week is a distinct answer from a code that never
  // existed: the desk should be told "that one has expired", not "no such
  // family", because the two lead a volunteer to do different things.
  if ((data.week_start as string) !== weekStart) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    householdId: data.household_id as string,
    weekStart: data.week_start as string,
  };
}

/**
 * Stop every credential this household currently holds.
 *
 * Revoking the row kills the typed code; bumping `code_rotation` kills the QR,
 * which carries the counter it was minted under and so stops verifying without
 * anything having to reach the parent's device.
 */
export async function rotateHouseholdCredentials(
  householdId: string,
  client?: SupabaseClient,
): Promise<boolean> {
  const admin = client ?? createAdminClient();

  const { data: household } = await admin
    .from("households")
    .select("code_rotation")
    .eq("id", householdId)
    .maybeSingle();

  if (!household) return false;

  const { error: revokeError } = await admin
    .from("household_checkout_codes")
    .update({ revoked_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .is("revoked_at", null);

  if (revokeError) return false;

  const { error } = await admin
    .from("households")
    .update({ code_rotation: Number(household.code_rotation ?? 0) + 1 })
    .eq("id", householdId);

  return !error;
}
