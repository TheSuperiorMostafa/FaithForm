import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderEmail } from "@/lib/email/layout";
import { resolveFromAddress } from "@/lib/email/sender";
import { getPlan } from "@/lib/service-plans/queries";
import { chartHasContent, lyricsFromChart, lyricsHaveContent } from "@/lib/service-plans/songs/chart";
import { formatPlanDate } from "@/lib/service-plans/timing";
import {
  NOTE_CATEGORIES,
  sharedPreset,
  type NoteCategory,
  type Plan,
  type PlanItem,
  type SharePreset,
} from "@/lib/service-plans/types";
import { presetDefaults, type PlanView, type PlanViewOptions } from "@/lib/service-plans/view";
import { absoluteAppPath } from "@/lib/site-url";
import { sendSms } from "@/lib/sms/send-sms";
import type { ChurchSmsSender } from "@/lib/sms/church-sender";

/**
 * Share links.
 *
 * A link's token is 32 bytes derived with HMAC-SHA256 from a server-only key
 * and the share row's random id. Only SHA-256(token) is stored, so the
 * database never holds a working link, and Re-send can send the *same* link
 * again instead of breaking the one already in someone's inbox. Revoking sets
 * `revoked_at`; expiry is `expires_at`. Without the server key no one can
 * produce a token, and a leaked database cannot be turned into links.
 */

function shareKey(): Buffer {
  const explicit = process.env.SERVICE_PLAN_SHARE_SECRET;
  if (explicit && explicit.length >= 32) return Buffer.from(explicit);
  const base = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Share links need SERVICE_PLAN_SHARE_SECRET or the Supabase secret key.");
  // A separate key for this purpose, so the database key itself is never the
  // HMAC key.
  return createHmac("sha256", base).update("faithform:service-plan-share:v1").digest();
}

export function tokenForShare(shareId: string): string {
  return createHmac("sha256", shareKey()).update(`service-plan-share|${shareId}`).digest("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Postgres bytea literal for PostgREST filters and inserts. */
export function byteaHex(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

export function shareUrl(token: string): string {
  return absoluteAppPath(`/plan/${token}`);
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ShareRow = {
  id: string;
  church_id: string;
  plan_id: string;
  audience: "team" | "person" | "link";
  team_id: string | null;
  person_id: string | null;
  preset: SharePreset;
  categories: NoteCategory[];
  channels: string[];
  version_sent: number;
  expires_at: string;
  revoked_at: string | null;
  first_viewed_at: string | null;
};

/**
 * Finds a live share by its token, with the service role. Returns null for
 * anything that should look like "no such link": unknown, revoked, expired.
 */
export async function findShareByToken(admin: SupabaseClient, token: string): Promise<ShareRow | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await admin
    .from("plan_shares")
    .select(
      "id, church_id, plan_id, audience, team_id, person_id, preset, categories, channels, version_sent, expires_at, revoked_at, first_viewed_at",
    )
    .eq("token_hash", byteaHex(hashToken(token)))
    .maybeSingle();
  if (error) {
    console.error("service-plans share lookup:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as ShareRow;
  // Constant-shape checks after the indexed lookup: a token whose hash
  // matched is the right token; expiry and revocation decide the rest.
  if (row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

/** What a share shows, as view options. Categories are clamped to the known set. */
export function shareViewOptions(share: Pick<ShareRow, "preset" | "categories" | "person_id">): PlanViewOptions {
  const base = presetDefaults(sharedPreset(share.preset));
  const categories = share.categories.filter((c): c is NoteCategory => (NOTE_CATEGORIES as readonly string[]).includes(c));
  return {
    ...base,
    categories: share.preset === "order" ? [] : categories,
    personId: share.person_id,
    timeId: null,
  };
}

export async function loadSharedPlan(admin: SupabaseClient, share: ShareRow): Promise<Plan | null> {
  return getPlan(admin, share.church_id, share.plan_id);
}

export async function recordView(admin: SupabaseClient, share: ShareRow): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, string> = { last_viewed_at: now };
  if (!share.first_viewed_at) patch.first_viewed_at = now;
  await admin.from("plan_shares").update(patch).eq("id", share.id).eq("church_id", share.church_id);
}

// ---------------------------------------------------------------------------
// Songs on a share link
// ---------------------------------------------------------------------------
//
// A link that shows files (every preset but Order only) also shows the chord
// chart and lyrics of each song on the rows its view shows, read from the
// arrangement the plan chose (or the song's first one). Same rule as files:
// only what this link's own view lists, only this plan's church.

/** One song as a share link shows it. */
export type SharedSong = {
  itemId: string;
  title: string;
  author: string | null;
  ccliNumber: string | null;
  copyright: string | null;
  arrangementName: string | null;
  /** The key the chart is written in. */
  chartKey: string | null;
  /** The key the plan lists for this item, when it is set. */
  planKey: string | null;
  bpm: number | null;
  chart: string | null;
  lyrics: string | null;
};

/** Song items on the rows this view shows; none for Order only. */
export function sharedSongItems(plan: Plan, view: PlanView): (PlanItem & { song: NonNullable<PlanItem["song"]> })[] {
  if (view.options.preset === "order") return [];
  const shown = new Set(view.rows.map((r) => r.id));
  return plan.items.filter(
    (item): item is PlanItem & { song: NonNullable<PlanItem["song"]> } =>
      item.itemType !== "header" && item.song !== null && shown.has(item.id),
  );
}

/** Whether a link with this preset shows files, charts and lyrics. */
export function shareShowsMaterials(preset: SharePreset): boolean {
  return sharedPreset(preset) !== "order";
}

/** Whether the plan has anything a recipient could open: files or songs. */
export function planHasMaterials(plan: Pick<Plan, "files" | "items">): boolean {
  return (plan.files?.length ?? 0) > 0 || plan.items.some((i) => i.song !== null);
}

/**
 * Charts and lyrics for the songs a share link's view shows, with the
 * service role, scoped to the share's church. `onlyItemId` narrows to one.
 */
export async function loadSharedSongs(
  admin: SupabaseClient,
  share: Pick<ShareRow, "church_id">,
  plan: Plan,
  view: PlanView,
  onlyItemId?: string,
): Promise<SharedSong[]> {
  const items = sharedSongItems(plan, view).filter((i) => !onlyItemId || i.id === onlyItemId);
  if (!items.length) return [];
  const songIds = [...new Set(items.map((i) => i.song.songId))];
  const [songs, arrangements] = await Promise.all([
    admin
      .from("songs")
      .select("id, title, author, ccli_number, copyright")
      .eq("church_id", share.church_id)
      .in("id", songIds),
    admin
      .from("song_arrangements")
      .select("id, song_id, name, key, bpm, chart_text, lyrics, sort_order, created_at")
      .eq("church_id", share.church_id)
      .in("song_id", songIds)
      .order("sort_order")
      .order("created_at"),
  ]);
  if (songs.error || arrangements.error) {
    console.error("service-plans share songs:", (songs.error ?? arrangements.error)?.message);
    return [];
  }
  const songById = new Map((songs.data ?? []).map((s) => [s.id as string, s]));
  const rows = arrangements.data ?? [];

  const out: SharedSong[] = [];
  for (const item of items) {
    const song = songById.get(item.song.songId);
    if (!song) continue;
    const arrangement =
      (item.song.arrangementId ? rows.find((a) => a.id === item.song.arrangementId) : undefined) ??
      rows.find((a) => a.song_id === item.song.songId);
    const chartText = (arrangement?.chart_text as string | null | undefined) ?? null;
    const ownLyrics = (arrangement?.lyrics as string | null | undefined) ?? null;
    const chart = chartHasContent(chartText) ? chartText : null;
    const lyricsText = ownLyrics?.trim() ? ownLyrics : chart ? lyricsFromChart(chart) : null;
    out.push({
      itemId: item.id,
      title: song.title as string,
      author: (song.author as string | null) ?? null,
      ccliNumber: (song.ccli_number as string | null) ?? null,
      copyright: (song.copyright as string | null) ?? null,
      arrangementName: (arrangement?.name as string | undefined) ?? null,
      chartKey: (arrangement?.key as string | null | undefined) ?? null,
      planKey: item.song.key,
      bpm: (arrangement?.bpm as number | null | undefined) ?? null,
      chart,
      lyrics: lyricsHaveContent(lyricsText) ? lyricsText : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type Delivery = "sent" | "no_email" | "no_phone" | "no_sender" | "emails_off" | "failed";

export async function emailShareLink(input: {
  to: string;
  personName: string;
  churchName: string;
  plan: Pick<Plan, "date" | "title" | "serviceTypeName">;
  url: string;
  expiresAt: string;
  updated: boolean;
  message: string | null;
  /** The link shows song charts, lyrics and files, and the plan has some. */
  includesMaterials?: boolean;
}): Promise<Delivery> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[FaithForm] Service plan link (no RESEND_API_KEY): not sent`);
    return "failed";
  }
  const when = input.plan.date ? formatPlanDate(input.plan.date) : "the service";
  const subject = input.updated
    ? `Updated: ${input.plan.serviceTypeName} plan for ${when}`
    : `${input.plan.serviceTypeName} plan for ${when}`;
  const content = renderEmail({
    title: subject,
    preheader: input.updated ? "The plan changed since you last saw it." : `Your plan for ${when}.`,
    heading: subject,
    blocks: [
      { kind: "paragraph", text: `Hi ${input.personName.split(" ")[0] || "there"},` },
      {
        kind: "paragraph",
        text: input.updated
          ? `${input.churchName} updated the plan for ${when}. Your link always shows the latest version.`
          : `${input.churchName} shared the plan for ${when} with you.`,
      },
      ...(input.message ? [{ kind: "quote" as const, text: input.message }] : []),
      ...(input.includesMaterials
        ? [{ kind: "paragraph" as const, text: "The chord charts, lyrics and files for this service are on the same page." }]
        : []),
      { kind: "paragraph", text: "Open the plan and tap “I’ll be there” or “Can’t make it” so your church knows." },
      { kind: "button", label: "Open the plan and answer", url: input.url },
      {
        kind: "muted",
        text: `This link is only for you and works until ${new Date(input.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. If the button does not work, paste this into your browser: ${input.url}`,
      },
    ],
    permissionNote: `You are getting this because ${input.churchName} added you to a service team.`,
  });
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: `${input.churchName} via FaithForm <${resolveFromAddress()}>`,
      to: input.to,
      subject,
      html: content.html,
      text: content.text,
    });
    if (error) {
      console.error("[FaithForm] Resend error (service plan share):", error.message);
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.error("[FaithForm] service plan share email:", e instanceof Error ? e.message : e);
    return "failed";
  }
}

export async function textShareLink(input: {
  sender: ChurchSmsSender | null;
  phone: string | null;
  churchName: string;
  plan: Pick<Plan, "date" | "serviceTypeName">;
  url: string;
  updated: boolean;
}): Promise<Delivery> {
  if (!input.phone) return "no_phone";
  if (!input.sender) return "no_sender";
  const when = input.plan.date ? formatPlanDate(input.plan.date, "short") : "the service";
  const body = input.updated
    ? `${input.churchName}: the ${input.plan.serviceTypeName} plan for ${when} changed. ${input.url}`
    : `${input.churchName}: here is the ${input.plan.serviceTypeName} plan for ${when}. Let us know if you can make it: ${input.url}`;
  const result = await sendSms(input.sender, input.phone, body);
  return result.ok ? "sent" : "failed";
}
