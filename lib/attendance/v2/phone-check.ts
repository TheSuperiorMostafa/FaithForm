import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getVisitorAccount } from "@/lib/faithform/account";
import {
  grantsPublishedContentAccess,
  type RelationshipState,
} from "@/lib/faithform/relationship-state";
import { resolveSelfCheckInMember } from "@/lib/attendance/v2/check-in";
import {
  readChurchAutomaticReadiness,
  type GeofenceConfigRefusal,
  type GeofenceWindow,
} from "@/lib/attendance/v2/geofence-config";

/**
 * "Would automatic check-in work on my phone?", answered for the staff member
 * looking at the dashboard, with the same checks a phone's request goes
 * through (`buildGeofenceConfiguration`).
 *
 * Dashboard staff are app users too — the app admits them to their own church
 * — so the person setting check-in up is usually the first person to try it.
 * When it did not work, the phone said only "Your church has not added a
 * location", and the dashboard showed a location. Both were right: the app
 * asks every church the account can see and, when all of them refuse, reports
 * the one whose web address sorts first — which can be a test church, or one
 * the person merely follows. This says which church the app is talking about,
 * and what is actually stopping this one.
 *
 * Only ever about the signed-in person's own account. Nothing here reads
 * another person's app account, relationship or consent.
 */

export type PhoneCheckVerdict = "ready" | Exclude<GeofenceConfigRefusal, "consent_required">;

export type PhoneCheck = {
  /** The person has signed in to the app at least once. */
  hasAppAccount: boolean;
  /** Their relationship with this church in the app. */
  membership: RelationshipState | "none";
  /** Whether their app account is connected to their record in People here. */
  connection: "linked" | "awaiting_confirmation" | "not_linked";
  linkedPersonName: string | null;
  /** They have turned automatic check-in on in the app. */
  consentGranted: boolean;
  /**
   * What this church's phone configuration would say for them the moment they
   * turn it on — the consent gate is the only one left out, because turning it
   * on *is* the step being checked.
   */
  verdict: PhoneCheckVerdict;
  nextWindow: GeofenceWindow | null;
  /**
   * What the app on their phone reports when they turn it on. Null when the
   * app would not be asked (no app account). `isThisChurch` false is the case
   * that confused people: the message is about another church.
   */
  appReport:
    | { kind: "watching"; churchNames: string[] }
    | { kind: "refused"; churchName: string; reason: PhoneCheckVerdict; isThisChurch: boolean }
    | null;
};

/** The churches the app asks, in the order it asks them (see AppDependencies.swift). */
const APP_CHURCH_LIMIT = 10;

/**
 * What the app says after asking every church, given each church's answer in
 * the order the app asks (by web address). Any church that offers it is
 * enough; when none does, the app in people's hands reports the first.
 */
export function appReportFor(
  answers: { churchId: string; name: string; verdict: PhoneCheckVerdict }[],
  thisChurchId: string,
): PhoneCheck["appReport"] {
  const watching = answers.filter((answer) => answer.verdict === "ready");
  if (watching.length > 0) {
    return { kind: "watching", churchNames: watching.map((answer) => answer.name) };
  }
  const first = answers[0];
  if (!first) return null;
  return {
    kind: "refused",
    churchName: first.name,
    reason: first.verdict,
    isThisChurch: first.churchId === thisChurchId,
  };
}

async function verdictFor(
  admin: SupabaseClient,
  accountId: string,
  churchId: string,
  now: Date,
): Promise<{ verdict: PhoneCheckVerdict; nextWindow: GeofenceWindow | null }> {
  const link = await resolveSelfCheckInMember(accountId, churchId, admin);
  if (!link.ok) {
    return {
      verdict: link.reason === "no_people_link" ? "no_people_link" : "not_enrolled",
      nextWindow: null,
    };
  }
  const readiness = await readChurchAutomaticReadiness(churchId, { client: admin, now });
  return {
    verdict: readiness.problem ?? "ready",
    nextWindow: readiness.windows[0] ?? null,
  };
}

export async function checkMyPhone(input: {
  userId: string;
  churchId: string;
  client?: SupabaseClient;
  now?: Date;
}): Promise<PhoneCheck> {
  const admin = input.client ?? createAdminClient();
  const now = input.now ?? new Date();

  const account = await getVisitorAccount(input.userId);
  if (!account || account.status !== "active") {
    return {
      hasAppAccount: false,
      membership: "none",
      connection: "not_linked",
      linkedPersonName: null,
      consentGranted: false,
      verdict: "not_enrolled",
      nextWindow: null,
      appReport: null,
    };
  }

  const [{ data: relationships }, { data: link }, { data: claim }] = await Promise.all([
    admin
      .from("visitor_church_relationships")
      .select("church_id, state, churches!inner(slug, name)")
      .eq("account_id", account.id)
      .limit(50),
    admin
      .from("visitor_people_links")
      .select("member_id, members!inner(first_name, last_name)")
      .eq("account_id", account.id)
      .eq("church_id", input.churchId)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("visitor_people_claims")
      .select("id")
      .eq("account_id", account.id)
      .eq("church_id", input.churchId)
      .in("status", ["pending", "disputed"])
      .maybeSingle(),
  ]);

  type Row = { church_id: string; state: RelationshipState; slug: string | null; name: string };
  const rows: Row[] = ((relationships ?? []) as Record<string, unknown>[]).map((row) => {
    const church = (Array.isArray(row.churches) ? row.churches[0] : row.churches) as
      | { slug: string | null; name: string }
      | null;
    return {
      church_id: row.church_id as string,
      state: row.state as RelationshipState,
      slug: church?.slug ?? null,
      name: church?.name ?? "",
    };
  });

  const here = rows.find((row) => row.church_id === input.churchId) ?? null;
  const member = (link?.members ?? null) as
    | { first_name: string; last_name: string }
    | { first_name: string; last_name: string }[]
    | null;
  const person = Array.isArray(member) ? member[0] : member;

  const mine = await verdictFor(admin, account.id, input.churchId, now);

  // Exactly the app's list: every church it can read, by web address.
  const asked = rows
    .filter((row) => row.slug && grantsPublishedContentAccess(row.state))
    .sort((a, b) => (a.slug as string).localeCompare(b.slug as string))
    .slice(0, APP_CHURCH_LIMIT);

  const answers = await Promise.all(
    asked.map(async (row) => ({
      churchId: row.church_id,
      name: row.name,
      verdict:
        row.church_id === input.churchId
          ? mine.verdict
          : (await verdictFor(admin, account.id, row.church_id, now)).verdict,
    })),
  );

  return {
    hasAppAccount: true,
    membership: here?.state ?? "none",
    connection: link ? "linked" : claim ? "awaiting_confirmation" : "not_linked",
    linkedPersonName: person
      ? `${person.first_name} ${person.last_name}`.trim() || null
      : null,
    consentGranted: account.autoAttendanceConsent === "granted",
    verdict: mine.verdict,
    nextWindow: mine.nextWindow,
    appReport: appReportFor(answers, input.churchId),
  };
}
