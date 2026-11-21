"use server";

import { randomUUID } from "node:crypto";
import { requireChurchAuth } from "@/lib/auth/church";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import { isChurchFeatureEmailEnabled } from "@/lib/features/access";
import { featureActionError } from "@/lib/features/guard";
import { getPlan } from "@/lib/service-plans/queries";
import { assertId, cleanText } from "@/lib/service-plans/server";
import {
  byteaHex,
  emailShareLink,
  hashToken,
  shareUrl,
  textShareLink,
  tokenForShare,
  type Delivery,
} from "@/lib/service-plans/share";
import {
  NOTE_CATEGORIES,
  SHARE_LINK_PRESETS,
  sharedPreset,
  type NoteCategory,
  type SharePreset,
  type TeamMemberStatus,
} from "@/lib/service-plans/types";
import { getChurchSmsSender } from "@/lib/sms/church-sender";
import { createAdminClient } from "@/lib/supabase/admin";
import { shiftYmd, zonedDateTimeToUtcMs } from "@/lib/utils/dates";

type Fail = { ok: false; error: string };

async function planner() {
  const auth = await requireChurchAuth();
  const denied = await featureActionError("service_plans");
  if (denied) throw new UserFacingError(denied);
  return { auth, admin: createAdminClient() };
}

type Channel = "email" | "sms";

export type ShareRecipientInput = {
  teams: { teamId: string; preset: SharePreset; categories: NoteCategory[] }[];
  people: { personId: string; preset: SharePreset; categories: NoteCategory[] }[];
  channels: Channel[];
  /** Also make one link to copy, showing this preset. */
  link: { preset: SharePreset; categories: NoteCategory[] } | null;
  message?: string | null;
};

export type ShareResult = {
  ok: true;
  sent: number;
  links: { label: string; url: string }[];
  problems: { name: string; reason: string }[];
};

const REASONS: Record<Exclude<Delivery, "sent">, string> = {
  no_email: "has no email address",
  no_phone: "has no mobile number",
  no_sender: "can't be texted: your church has no texting number set up",
  emails_off: "wasn't emailed: Service Plans emails are switched off for your church",
  failed: "couldn't be reached. Try again later",
};

// Shared links never show the Team view; an old client asking for it gets the full plan.
const cleanPreset = (p: unknown): SharePreset =>
  p === "team" ? "full" : (SHARE_LINK_PRESETS as readonly string[]).includes(p as string) ? (p as SharePreset) : "order";
const cleanCategories = (c: unknown): NoteCategory[] =>
  Array.isArray(c) ? [...new Set(c.filter((x): x is NoteCategory => (NOTE_CATEGORIES as readonly string[]).includes(x)))] : [];

/** Links last until the end of the day after the service. */
function expiryFor(planDate: string | null, timeZone: string): string {
  const fallback = Date.now() + 3 * 86_400_000;
  if (!planDate) return new Date(fallback).toISOString();
  const at = zonedDateTimeToUtcMs(shiftYmd(planDate, 2), "00:00", timeZone);
  return new Date(Math.max(at, Date.now() + 86_400_000)).toISOString();
}

export async function createShareAction(planId: string, input: ShareRecipientInput): Promise<ShareResult | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await getPlan(admin, auth.churchId, id);
    if (!plan || plan.isTemplate) throw new UserFacingError("We couldn't find that plan.");

    const channels = (Array.isArray(input.channels) ? input.channels : []).filter((c): c is Channel => c === "email" || c === "sms");
    const message = cleanText(input.message, 500);
    const expiresAt = expiryFor(plan.date, auth.churchTimezone);
    const sendId = randomUUID();

    // Who gets a personal link: everyone on each chosen team for this date
    // (not those who declined), plus chosen individuals. One link each.
    type Recipient = { personId: string; audience: "team" | "person"; teamId: string | null; preset: SharePreset; categories: NoteCategory[] };
    const recipients = new Map<string, Recipient>();
    for (const t of (input.teams ?? []).slice(0, 30)) {
      const teamId = assertId(t.teamId);
      for (const m of plan.team.filter((m) => m.teamId === teamId && m.status !== "declined")) {
        if (!recipients.has(m.personId)) {
          recipients.set(m.personId, { personId: m.personId, audience: "team", teamId, preset: cleanPreset(t.preset), categories: cleanCategories(t.categories) });
        }
      }
    }
    for (const p of (input.people ?? []).slice(0, 200)) {
      const personId = assertId(p.personId);
      recipients.set(personId, { personId, audience: "person", teamId: null, preset: cleanPreset(p.preset), categories: cleanCategories(p.categories) });
    }
    if (!recipients.size && !input.link) throw new UserFacingError("Pick at least one team or person, or make a link to copy.");
    if (recipients.size && !channels.length) throw new UserFacingError("Pick how to send it: email, text or both.");

    const ids = [...recipients.keys()];
    const { data: people, error: peopleError } = ids.length
      ? await admin.from("members").select("id, first_name, last_name, email, phone").eq("church_id", auth.churchId).in("id", ids)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    const personById = new Map((people ?? []).map((p) => [p.id as string, p]));

    const [emailsOn, smsSender] = await Promise.all([
      channels.includes("email") ? isChurchFeatureEmailEnabled(auth.churchId, "service_plans") : Promise.resolve(false),
      channels.includes("sms") ? getChurchSmsSender(auth.churchId, admin) : Promise.resolve(null),
    ]);

    const rows: Record<string, unknown>[] = [];
    const work: (() => Promise<{ shareId: string; name: string; delivery: Record<string, Delivery> }>)[] = [];
    for (const r of recipients.values()) {
      const person = personById.get(r.personId);
      if (!person) continue;
      const shareId = randomUUID();
      const token = tokenForShare(shareId);
      const url = shareUrl(token);
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ") || "Someone";
      rows.push({
        id: shareId,
        church_id: auth.churchId,
        plan_id: plan.id,
        send_id: sendId,
        audience: r.audience,
        team_id: r.teamId,
        person_id: r.personId,
        preset: r.preset,
        categories: r.preset === "order" ? [] : r.categories,
        channels,
        token_hash: byteaHex(hashToken(token)),
        version_sent: plan.shareVersion,
        expires_at: expiresAt,
        created_by: auth.userId,
      });
      work.push(async () => {
        const delivery: Record<string, Delivery> = {};
        if (channels.includes("email")) {
          delivery.email = !emailsOn
            ? "emails_off"
            : person.email
              ? await emailShareLink({
                  to: person.email as string,
                  personName: name,
                  churchName: auth.churchName ?? "Your church",
                  plan,
                  url,
                  expiresAt,
                  updated: false,
                  message,
                })
              : "no_email";
        }
        if (channels.includes("sms")) {
          delivery.sms = await textShareLink({
            sender: smsSender,
            phone: (person.phone as string | null) ?? null,
            churchName: auth.churchName ?? "Your church",
            plan,
            url,
            updated: false,
          });
        }
        return { shareId, name, delivery };
      });
    }

    const links: { label: string; url: string }[] = [];
    if (input.link) {
      const shareId = randomUUID();
      const token = tokenForShare(shareId);
      const preset = cleanPreset(input.link.preset);
      rows.push({
        id: shareId,
        church_id: auth.churchId,
        plan_id: plan.id,
        send_id: sendId,
        audience: "link",
        preset,
        categories: preset === "order" ? [] : cleanCategories(input.link.categories),
        channels: ["link"],
        token_hash: byteaHex(hashToken(token)),
        version_sent: plan.shareVersion,
        expires_at: expiresAt,
        created_by: auth.userId,
      });
      links.push({ label: "Link to copy", url: shareUrl(token) });
    }

    // The rows exist before anything is sent, so a link in a message always works.
    if (rows.length) {
      const { error } = await admin.from("plan_shares").insert(rows);
      if (error) throw error;
    }

    const results = await Promise.all(work.map((w) => w()));
    let sent = 0;
    const problems: { name: string; reason: string }[] = [];
    for (const r of results) {
      if (Object.values(r.delivery).includes("sent")) sent += 1;
      for (const [, outcome] of Object.entries(r.delivery)) {
        if (outcome !== "sent") problems.push({ name: r.name, reason: REASONS[outcome] });
      }
      await admin.from("plan_shares").update({ delivery: r.delivery }).eq("church_id", auth.churchId).eq("id", r.shareId);
    }
    return { ok: true, sent, links, problems };
  } catch (e) {
    return { ok: false, error: toUserError(e, "We couldn't share the plan.") };
  }
}

/** Sends the same links again, only to people whose last version is behind. */
export async function resendShareAction(planId: string): Promise<{ ok: true; sent: number } | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await getPlan(admin, auth.churchId, id);
    if (!plan) throw new UserFacingError("We couldn't find that plan.");
    const { data: shares, error } = await admin
      .from("plan_shares")
      .select("id, person_id, channels, version_sent, expires_at")
      .eq("church_id", auth.churchId)
      .eq("plan_id", id)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .lt("version_sent", plan.shareVersion);
    if (error) throw error;

    const personIds = [...new Set((shares ?? []).map((s) => s.person_id).filter(Boolean) as string[])];
    const { data: people } = personIds.length
      ? await admin.from("members").select("id, first_name, last_name, email, phone").eq("church_id", auth.churchId).in("id", personIds)
      : { data: [] };
    const byId = new Map((people ?? []).map((p) => [p.id as string, p]));
    const channelsUsed = new Set((shares ?? []).flatMap((s) => s.channels as string[]));
    const [emailsOn, smsSender] = await Promise.all([
      channelsUsed.has("email") ? isChurchFeatureEmailEnabled(auth.churchId, "service_plans") : Promise.resolve(false),
      channelsUsed.has("sms") ? getChurchSmsSender(auth.churchId, admin) : Promise.resolve(null),
    ]);

    let sent = 0;
    for (const share of shares ?? []) {
      const person = share.person_id ? byId.get(share.person_id as string) : null;
      // Copy-link shares have no one to notify; they already show the latest plan.
      if (!person) {
        await admin.from("plan_shares").update({ version_sent: plan.shareVersion }).eq("church_id", auth.churchId).eq("id", share.id);
        continue;
      }
      const url = shareUrl(tokenForShare(share.id as string));
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ") || "Someone";
      const channels = share.channels as string[];
      const outcomes: Delivery[] = [];
      if (channels.includes("email") && emailsOn && person.email) {
        outcomes.push(
          await emailShareLink({
            to: person.email as string,
            personName: name,
            churchName: auth.churchName ?? "Your church",
            plan,
            url,
            expiresAt: share.expires_at as string,
            updated: true,
            message: null,
          }),
        );
      }
      if (channels.includes("sms")) {
        outcomes.push(
          await textShareLink({ sender: smsSender, phone: (person.phone as string | null) ?? null, churchName: auth.churchName ?? "Your church", plan, url, updated: true }),
        );
      }
      if (outcomes.includes("sent")) sent += 1;
      await admin.from("plan_shares").update({ version_sent: plan.shareVersion }).eq("church_id", auth.churchId).eq("id", share.id);
    }
    return { ok: true, sent };
  } catch (e) {
    return { ok: false, error: toUserError(e, "We couldn't re-send the plan.") };
  }
}

export type ShareListRow = {
  id: string;
  audience: "team" | "person" | "link";
  name: string;
  preset: SharePreset;
  createdAt: string;
  expiresAt: string;
  firstViewedAt: string | null;
  upToDate: boolean;
  revoked: boolean;
  /** Their answer through any of their links; null for a link to copy. */
  answer: TeamMemberStatus | null;
};

/** Who the plan was shared with and who has opened it. */
export async function listSharesAction(planId: string): Promise<{ ok: true; shares: ShareListRow[] } | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await getPlan(admin, auth.churchId, id);
    if (!plan) throw new UserFacingError("We couldn't find that plan.");
    const { data, error } = await admin
      .from("plan_shares")
      .select("id, audience, person_id, preset, created_at, expires_at, first_viewed_at, version_sent, revoked_at")
      .eq("church_id", auth.churchId)
      .eq("plan_id", id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    const personIds = [...new Set((data ?? []).map((s) => s.person_id).filter(Boolean) as string[])];
    const { data: people } = personIds.length
      ? await admin.from("members").select("id, first_name, last_name").eq("church_id", auth.churchId).in("id", personIds)
      : { data: [] };
    const names = new Map((people ?? []).map((p) => [p.id as string, [p.first_name, p.last_name].filter(Boolean).join(" ")]));
    const attendance = new Map((plan.attendance ?? []).map((a) => [a.personId, a.status]));
    return {
      ok: true,
      shares: (data ?? []).map((s) => ({
        id: s.id as string,
        audience: s.audience as ShareListRow["audience"],
        name: s.person_id ? (names.get(s.person_id as string) ?? "Someone") : "Link to copy",
        preset: sharedPreset(s.preset as SharePreset),
        createdAt: s.created_at as string,
        expiresAt: s.expires_at as string,
        firstViewedAt: (s.first_viewed_at as string | null) ?? null,
        upToDate: (s.version_sent as number) >= plan.shareVersion,
        revoked: Boolean(s.revoked_at),
        answer: s.person_id ? (attendance.get(s.person_id as string) ?? "unconfirmed") : null,
      })),
    };
  } catch (e) {
    return { ok: false, error: toUserError(e, "We couldn't load who this plan was shared with.") };
  }
}

export async function revokeShareAction(shareId: string, revoked: boolean): Promise<{ ok: true } | Fail> {
  try {
    const { auth, admin } = await planner();
    const { error } = await admin
      .from("plan_shares")
      .update({ revoked_at: revoked ? new Date().toISOString() : null })
      .eq("church_id", auth.churchId)
      .eq("id", assertId(shareId));
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e, "We couldn't turn off that link.") };
  }
}

/** The link again, for Copy on a row in the share list. */
export async function copyShareLinkAction(shareId: string): Promise<{ ok: true; url: string } | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(shareId);
    const { data, error } = await admin.from("plan_shares").select("id").eq("church_id", auth.churchId).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new UserFacingError("We couldn't find that link.");
    return { ok: true, url: shareUrl(tokenForShare(id)) };
  } catch (e) {
    return { ok: false, error: toUserError(e, "We couldn't copy that link.") };
  }
}
