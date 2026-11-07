import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import { issueWeeklyCode } from "@/lib/checkin/household-credentials";
import { serviceWeekStart } from "@/lib/checkin/service-week";

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error("guardian_data_unavailable");
  return result.data;
}
const one = <T>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

/** Verified People links, never contact details, grant guardian access. Reused at delivery. */
export async function guardianAccountIds(churchId: string, householdId: string, client?: SupabaseClient): Promise<string[]> {
  const admin = client ?? createAdminClient();
  const feature = checked(await admin.from("church_features").select("enabled").eq("church_id", churchId).eq("feature_key", "checkin").maybeSingle());
  if (feature?.enabled === false) return [];
  const members = checked(await admin.from("household_members").select("member_id").eq("church_id", churchId).eq("household_id", householdId).eq("relationship", "guardian").limit(200));
  if (!members?.length) return [];
  const links = checked(await admin.from("visitor_people_links").select("account_id").eq("church_id", churchId).eq("is_active", true).in("member_id", members.map(row => row.member_id)));
  const ids = [...new Set((links ?? []).map(row => row.account_id as string))];
  if (!ids.length) return [];
  const [accountsResult, relationshipsResult] = await Promise.all([
    admin.from("visitor_accounts").select("id").eq("status", "active").in("id", ids),
    admin.from("visitor_church_relationships").select("account_id").eq("church_id", churchId).in("account_id", ids).in("state", ["following", "pending", "joined"]),
  ]);
  const active = new Set((checked(accountsResult) ?? []).map(row => row.id));
  return (checked(relationshipsResult) ?? []).map(row => row.account_id as string).filter(id => active.has(id));
}

export async function kidsCheckIn(userId: string, slug: string, client?: SupabaseClient) {
  const admin = client ?? createAdminClient();
  const account = checked(await admin.from("visitor_accounts").select("id, status").eq("user_id", userId).maybeSingle());
  if (!account) throw new VisitorError("account_missing", "No visitor account.");
  if (account.status !== "active") throw new VisitorError("account_inactive", "This account is not active.");
  const church = checked(await admin.from("churches").select("id, timezone").eq("slug", slug).maybeSingle());
  if (!church) throw new VisitorError("church_not_found", "Church not found.");
  const relationship = checked(await admin.from("visitor_church_relationships").select("state").eq("church_id", church.id).eq("account_id", account.id).maybeSingle());
  if (!relationship || !["following", "pending", "joined"].includes(relationship.state)) throw new VisitorError("church_not_found", "Church not found.");
  const feature = checked(await admin.from("church_features").select("enabled").eq("church_id", church.id).eq("feature_key", "checkin").maybeSingle());
  if (feature?.enabled === false) return { households: [] };
  const link = checked(await admin.from("visitor_people_links").select("member_id").eq("church_id", church.id).eq("account_id", account.id).eq("is_active", true).maybeSingle());
  if (!link) return { households: [] };
  const memberships = checked(await admin.from("household_members").select("household_id, households(id, name)").eq("church_id", church.id).eq("member_id", link.member_id).eq("relationship", "guardian").limit(1));
  const households = await Promise.all((memberships ?? []).map(async membership => {
    const household = one(membership.households as { id: string; name: string }[] | null);
    if (!household) throw new Error("guardian_data_unavailable");
    const pickupCode = await issueWeeklyCode({ churchId: church.id, householdId: household.id, weekStart: serviceWeekStart(church.timezone ?? "America/New_York") }, admin);
    if (!pickupCode) throw new Error("guardian_code_unavailable");
    const dependents = checked(await admin.from("household_members").select("member_id").eq("church_id", church.id).eq("household_id", household.id).eq("relationship", "dependent").limit(500));
    const dependentIds = new Set((dependents ?? []).map(row => row.member_id));
    const sessionRows = checked(await admin.from("checkin_sessions").select("id, member_id, checked_in_at, members!member_id(first_name,last_name), church_locations(name)").eq("church_id", church.id).eq("household_id", household.id).eq("status", "checked_in").limit(500));
    const sessions = (sessionRows ?? []).filter(row => dependentIds.has(row.member_id));
    // If a desk-time enqueue failed, opening the app retries the idempotent availability notice.
    try { await notifyHouseholdCode(church.id, household.id, admin); } catch { /* Code remains available here. */ }
    const children = (sessions ?? []).map(session => {
      const person = one(session.members as { first_name: string; last_name: string }[] | null);
      const room = one(session.church_locations as { name: string }[] | null);
      return { id: session.member_id as string, name: [person?.first_name, person?.last_name].filter(Boolean).join(" "), roomName: room?.name ?? "Kids room", checkedInAt: session.checked_in_at as string };
    });
    const rows = checked(await admin.from("checkin_guardian_alerts").select("id, session_id, created_at").eq("church_id", church.id).eq("household_id", household.id).order("created_at", { ascending: false }).limit(20));
    const bySession = new Map((sessions ?? []).map((session, index) => [session.id, children[index]]));
    const alerts = (rows ?? []).flatMap(alert => {
      const child = bySession.get(alert.session_id);
      return child ? [{ id: alert.id as string, childName: child.name, roomName: child.roomName, createdAt: alert.created_at as string }] : [];
    });
    return { id: household.id, label: household.name, pickupCode, children, alerts };
  }));
  return { households };
}

export async function notifyHouseholdCode(churchId: string, householdId: string, client?: SupabaseClient): Promise<boolean> {
  const admin = client ?? createAdminClient();
  const household = checked(await admin.from("households").select("id, code_rotation").eq("id", householdId).eq("church_id", churchId).maybeSingle());
  const church = checked(await admin.from("churches").select("slug, timezone").eq("id", churchId).maybeSingle());
  if (!household || !church?.slug) return false;
  const accountIds = await guardianAccountIds(churchId, householdId, admin);
  if (!accountIds.length) return false;
  const week = serviceWeekStart(church.timezone ?? "America/New_York");
  const code = await issueWeeklyCode({ churchId, householdId, weekStart: week }, admin);
  if (!code) throw new Error("guardian_code_unavailable");
  // Per-account dedupe also reaches a guardian verified later in the same week.
  for (const accountId of accountIds) {
    const { error } = await admin.from("notification_outbox").insert({ church_id: churchId, kind: "household_code_ready", subject_type: "household", subject_id: householdId, subject_version: Number(household.code_rotation ?? 0), target_visibility: "members", target_account_ids: [accountId], topic: "checkin", title: "Your household pickup code is ready", body: "Open Kids Check in to see your household's pickup code.", deep_link: `faithform://church/${church.slug}/check-in`, collapse_key: `household-${householdId}`, dedupe_key: createHash("sha256").update(`household:${householdId}:${week}:${household.code_rotation}:${accountId}`).digest("hex") });
    if (error && error.code !== "23505") throw new Error("guardian_notification_unavailable");
  }
  return true;
}

/** Called only after station authorization. Never invokes a provider from a request. */
export async function queueGuardianAlert(churchId: string, sessionId: string, actorUserId: string, client?: SupabaseClient): Promise<{ queued: boolean; guardianCount: number }> {
  const admin = client ?? createAdminClient();
  const session = checked(await admin.from("checkin_sessions").select("id, household_id, member_id").eq("id", sessionId).eq("church_id", churchId).eq("status", "checked_in").maybeSingle());
  if (!session?.household_id) return { queued: false, guardianCount: 0 };
  // A moved household or removed dependent must not alert its former guardians.
  const dependent = checked(await admin.from("household_members").select("id").eq("church_id", churchId).eq("household_id", session.household_id).eq("member_id", session.member_id).eq("relationship", "dependent").maybeSingle());
  if (!dependent) return { queued: false, guardianCount: 0 };
  const accountIds = await guardianAccountIds(churchId, session.household_id, admin);
  if (!accountIds.length) return { queued: false, guardianCount: 0 };
  const church = checked(await admin.from("churches").select("slug").eq("id", churchId).maybeSingle());
  if (!church?.slug) return { queued: false, guardianCount: 0 };
  const id = randomUUID();
  // A short per-child bucket makes simultaneous/double clicks one alert.
  const bucket = Math.floor(Date.now() / 60_000);
  const { data: queued, error } = await admin.rpc("queue_checkin_guardian_alert", { p_id: id, p_church_id: churchId, p_session_id: sessionId, p_household_id: session.household_id, p_actor_user_id: actorUserId, p_account_ids: accountIds, p_deep_link: `faithform://church/${church.slug}/check-in`, p_dedupe_key: `checkin-alert:${sessionId}:${bucket}` });
  if (error) throw new Error("guardian_notification_unavailable");
  return { queued: queued === true, guardianCount: accountIds.length };
}
