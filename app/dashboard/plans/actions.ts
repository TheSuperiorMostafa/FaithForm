"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { keysBetween } from "@/lib/service-plans/fractional-index";
import { getPlan } from "@/lib/service-plans/queries";
import {
  assertId,
  assertItem,
  assertPlan,
  assertServiceType,
  cleanText,
  isUniqueViolation,
  keyAfter,
  optionalId,
  planPositions,
  rebalanceIfNeeded,
  requireText,
  timesForPlan,
} from "@/lib/service-plans/server";
import {
  defaultCategoriesForTeam,
  STARTER_ITEMS,
  STARTER_SERVICE_TYPE,
  STARTER_TEAMS,
} from "@/lib/service-plans/starter";
import { weekdayOf } from "@/lib/service-plans/timing";
import {
  ITEM_TYPES,
  NOTE_CATEGORIES,
  TEAM_MEMBER_STATUSES,
  TIME_KINDS,
  type ItemType,
  type NoteCategory,
  type Plan,
  type ServiceTypeTime,
  type TeamMemberStatus,
  type TimeKind,
} from "@/lib/service-plans/types";
import { cleanAlertEmails, cleanAlertPhones } from "@/lib/service-plans/alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import { zonedDateTimeToUtcMs } from "@/lib/utils/dates";

/**
 * Service Plans server actions. Each one is a public POST endpoint, so each
 * checks the caller (signed in, Service Plans feature) before anything else,
 * then writes with the service role scoped to the caller's church. The
 * browser has no write path to these tables.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

async function planner(): Promise<{ auth: ChurchAuth; admin: ReturnType<typeof createAdminClient> }> {
  const auth = await requireChurchAuth();
  const denied = await featureActionError("service_plans");
  if (denied) throw new UserFacingError(denied);
  return { auth, admin: createAdminClient() };
}

function failed(error: unknown, fallback: string): Fail {
  return { ok: false, error: toUserError(error, fallback) };
}

function revalidatePlans(serviceTypeId?: string, planId?: string) {
  revalidatePath("/dashboard/plans");
  if (serviceTypeId) revalidatePath(`/dashboard/plans/${serviceTypeId}`);
  if (serviceTypeId && planId) revalidatePath(`/dashboard/plans/${serviceTypeId}/${planId}`);
}

function isTimeKind(v: unknown): v is TimeKind {
  return typeof v === "string" && (TIME_KINDS as readonly string[]).includes(v);
}

function cleanTimes(input: unknown): Omit<ServiceTypeTime, "id">[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).flatMap((t) => {
    const weekday = Number(t?.weekday);
    const localTime = typeof t?.localTime === "string" && /^\d{2}:\d{2}$/.test(t.localTime) ? t.localTime : null;
    const label = cleanText(t?.label, 60);
    if (!localTime || !label || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return [];
    return [{ kind: isTimeKind(t?.kind) ? t.kind : "service", label, weekday, localTime }];
  });
}

// ---------------------------------------------------------------------------
// Service types
// ---------------------------------------------------------------------------

export async function createServiceTypeAction(input: {
  name?: string;
  starter?: boolean;
}): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const starter = input.starter === true;
    const name = starter ? (cleanText(input.name, 80) ?? STARTER_SERVICE_TYPE.name) : requireText(input.name, 80, "service type");

    const { data: type, error } = await admin
      .from("service_types")
      .insert({
        church_id: auth.churchId,
        name,
        default_weekday: starter ? STARTER_SERVICE_TYPE.defaultWeekday : 0,
        target_seconds: starter ? STARTER_SERVICE_TYPE.targetSeconds : null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const typeId = type.id as string;

    const times = starter
      ? STARTER_SERVICE_TYPE.times
      : [{ kind: "service", label: "Service", weekday: 0, localTime: "10:00" }];
    const { error: timesError } = await admin.from("service_type_times").insert(
      times.map((t, i) => ({
        church_id: auth.churchId,
        service_type_id: typeId,
        kind: t.kind,
        label: t.label,
        weekday: t.weekday,
        local_time: t.localTime,
        sort_order: i,
      })),
    );
    if (timesError) throw timesError;

    if (starter) {
      // The starter order lives in a template the first plan is made from.
      const { data: template, error: templateError } = await admin
        .from("plans")
        .insert({
          church_id: auth.churchId,
          service_type_id: typeId,
          is_template: true,
          title: "Standard Sunday",
          created_by: auth.userId,
          updated_by: auth.userId,
        })
        .select("id")
        .single();
      if (templateError) throw templateError;
      const keys = keysBetween(null, null, STARTER_ITEMS.length);
      const { error: itemsError } = await admin.from("plan_items").insert(
        STARTER_ITEMS.map((item, i) => ({
          church_id: auth.churchId,
          plan_id: template.id,
          position: keys[i],
          item_type: item.itemType,
          title: item.title,
          length_seconds: item.lengthSeconds,
          description: item.description ?? null,
        })),
      );
      if (itemsError) throw itemsError;
      const { error: defaultError } = await admin
        .from("service_types")
        .update({ default_template_id: template.id })
        .eq("church_id", auth.churchId)
        .eq("id", typeId);
      if (defaultError) throw defaultError;

      for (const [i, team] of STARTER_TEAMS.entries()) {
        await insertTeam(admin, auth.churchId, typeId, team.name, team.positions, team.categories, i);
      }
    }

    revalidatePlans();
    return { ok: true, id: typeId };
  } catch (e) {
    return failed(e, "We couldn't create the service type.");
  }
}

async function insertTeam(
  admin: ReturnType<typeof createAdminClient>,
  churchId: string,
  serviceTypeId: string,
  name: string,
  positions: string[],
  categories: NoteCategory[],
  sortOrder: number,
): Promise<string> {
  const { data: team, error } = await admin
    .from("teams")
    .insert({ church_id: churchId, service_type_id: serviceTypeId, name, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw error;
  if (positions.length) {
    const { error: posError } = await admin.from("team_positions").insert(
      positions.map((p, i) => ({ church_id: churchId, team_id: team.id, name: p, sort_order: i })),
    );
    if (posError) throw posError;
  }
  if (categories.length) {
    const { error: catError } = await admin
      .from("team_note_categories")
      .insert(categories.map((category) => ({ church_id: churchId, team_id: team.id, category })));
    if (catError) throw catError;
  }
  return team.id as string;
}

export async function updateServiceTypeAction(
  serviceTypeId: string,
  input: {
    name?: string;
    defaultWeekday?: number | null;
    targetMinutes?: number | null;
    defaultTemplateId?: string | null;
    times?: Omit<ServiceTypeTime, "id">[];
    /** Told when someone answers a shared plan of this type. */
    responseEmails?: string[];
    responsePhones?: string[];
  },
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(serviceTypeId);
    await assertServiceType(admin, auth.churchId, id);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = requireText(input.name, 80, "service type");
    if (input.defaultWeekday !== undefined) {
      const d = input.defaultWeekday;
      patch.default_weekday = d === null || (Number.isInteger(d) && d >= 0 && d <= 6) ? d : 0;
    }
    if (input.targetMinutes !== undefined) {
      const m = Number(input.targetMinutes);
      patch.target_seconds = input.targetMinutes === null || !m ? null : Math.min(1440, Math.max(1, Math.round(m))) * 60;
    }
    if (input.defaultTemplateId !== undefined) {
      const templateId = optionalId(input.defaultTemplateId);
      if (templateId) {
        const template = await assertPlan(admin, auth.churchId, templateId);
        if (!template.isTemplate || template.serviceTypeId !== id) {
          throw new UserFacingError("Pick one of this service type's templates.");
        }
      }
      patch.default_template_id = templateId;
    }
    if (input.responseEmails !== undefined) patch.response_notify_emails = cleanAlertEmails(input.responseEmails);
    if (input.responsePhones !== undefined) patch.response_notify_phones = cleanAlertPhones(input.responsePhones);
    if (Object.keys(patch).length) {
      const { error } = await admin.from("service_types").update(patch).eq("church_id", auth.churchId).eq("id", id);
      if (error) throw error;
    }

    if (input.times !== undefined) {
      const times = cleanTimes(input.times);
      if (!times.some((t) => t.kind === "service")) {
        throw new UserFacingError("Keep at least one service time.");
      }
      const { error: delError } = await admin
        .from("service_type_times")
        .delete()
        .eq("church_id", auth.churchId)
        .eq("service_type_id", id);
      if (delError) throw delError;
      const { error: insError } = await admin.from("service_type_times").insert(
        times.map((t, i) => ({
          church_id: auth.churchId,
          service_type_id: id,
          kind: t.kind,
          label: t.label,
          weekday: t.weekday,
          local_time: t.localTime,
          sort_order: i,
        })),
      );
      if (insError) throw insError;
    }

    revalidatePlans(id);
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't save the service type.");
  }
}

export async function archiveServiceTypeAction(serviceTypeId: string, archived: boolean): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(serviceTypeId);
    const { error } = await admin
      .from("service_types")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("church_id", auth.churchId)
      .eq("id", id);
    if (error) throw error;
    revalidatePlans(id);
    return { ok: true };
  } catch (e) {
    return failed(e, archived ? "We couldn't archive the service type." : "We couldn't restore the service type.");
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlanSource = { kind: "template"; id: string } | { kind: "copy"; id: string } | { kind: "blank" };

export async function createPlanAction(input: {
  serviceTypeId: string;
  date: string;
  title?: string | null;
  series?: string | null;
  source: PlanSource;
}): Promise<Ok<{ id: string; serviceTypeId: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const typeId = assertId(input.serviceTypeId);
    await assertServiceType(admin, auth.churchId, typeId);
    if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new UserFacingError("Pick a date for this plan.");
    }

    let sourceId: string | null = null;
    let sourceTitle: string | null = null;
    let sourceSeries: string | null = null;
    if (input.source.kind !== "blank") {
      sourceId = assertId(input.source.id);
      const source = await assertPlan(admin, auth.churchId, sourceId);
      if (source.serviceTypeId !== typeId) throw new UserFacingError("Pick a plan or template from this service type.");
      if ((input.source.kind === "template") !== source.isTemplate) {
        throw new UserFacingError("Pick a plan or template from this service type.");
      }
      if (input.source.kind === "copy") {
        const { data } = await admin.from("plans").select("title, series").eq("id", sourceId).single();
        sourceTitle = (data?.title as string | null) ?? null;
        sourceSeries = (data?.series as string | null) ?? null;
      }
    }

    const { data: plan, error } = await admin
      .from("plans")
      .insert({
        church_id: auth.churchId,
        service_type_id: typeId,
        plan_date: input.date,
        title: cleanText(input.title, 120) ?? sourceTitle,
        series: cleanText(input.series, 120) ?? sourceSeries,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    const planId = plan.id as string;

    try {
      // Times: the type's defaults on this date, in the church's time zone.
      const { data: defaults, error: defaultsError } = await admin
        .from("service_type_times")
        .select("kind, label, weekday, local_time")
        .eq("church_id", auth.churchId)
        .eq("service_type_id", typeId)
        .order("sort_order");
      if (defaultsError) throw defaultsError;
      const times = timesForPlan(
        input.date,
        weekdayOf(input.date),
        (defaults ?? []).map((t) => ({
          id: "",
          kind: t.kind as TimeKind,
          label: t.label as string,
          weekday: t.weekday as number,
          localTime: (t.local_time as string).slice(0, 5),
        })),
        auth.churchTimezone,
      );
      if (times.length) {
        const { error: timesError } = await admin
          .from("plan_times")
          .insert(times.map((t) => ({ ...t, church_id: auth.churchId, plan_id: planId })));
        if (timesError) throw timesError;
      }

      if (sourceId) {
        const { error: copyError } = await admin.rpc("service_plan_copy_contents", {
          p_church_id: auth.churchId,
          p_source_plan_id: sourceId,
          p_target_plan_id: planId,
        });
        if (copyError) throw copyError;
      }
    } catch (inner) {
      // Leave nothing half-made behind.
      await admin.from("plans").delete().eq("church_id", auth.churchId).eq("id", planId);
      throw inner;
    }

    revalidatePlans(typeId);
    return { ok: true, id: planId, serviceTypeId: typeId };
  } catch (e) {
    return failed(e, "We couldn't create the plan.");
  }
}

export async function updatePlanAction(
  planId: string,
  input: { title?: string | null; series?: string | null; date?: string },
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await assertPlan(admin, auth.churchId, id);
    const patch: Record<string, unknown> = { updated_by: auth.userId };
    if (input.title !== undefined) {
      patch.title = cleanText(input.title, 120);
      if (plan.isTemplate && !patch.title) throw new UserFacingError("Give the template a name.");
    }
    if (input.series !== undefined) patch.series = cleanText(input.series, 120);
    let dayShift = 0;
    if (input.date !== undefined && !plan.isTemplate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new UserFacingError("Pick a date for this plan.");
      patch.plan_date = input.date;
      if (plan.date) {
        dayShift = Math.round(
          (Date.parse(`${input.date}T12:00:00Z`) - Date.parse(`${plan.date}T12:00:00Z`)) / 86_400_000,
        );
      }
    }
    const { error } = await admin.from("plans").update(patch).eq("church_id", auth.churchId).eq("id", id);
    if (error) throw error;

    // Moving the date moves its times with it, keeping the wall-clock time.
    if (dayShift !== 0) {
      const { data: times, error: timesError } = await admin
        .from("plan_times")
        .select("id, starts_at")
        .eq("church_id", auth.churchId)
        .eq("plan_id", id);
      if (timesError) throw timesError;
      for (const t of times ?? []) {
        const local = new Intl.DateTimeFormat("en-CA", {
          timeZone: auth.churchTimezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(t.starts_at as string));
        const part = (type: string) => local.find((p) => p.type === type)?.value ?? "00";
        const ymd = `${part("year")}-${part("month")}-${part("day")}`;
        const shifted = new Date(Date.parse(`${ymd}T12:00:00Z`) + dayShift * 86_400_000).toISOString().slice(0, 10);
        const startsAt = new Date(
          zonedDateTimeToUtcMs(shifted, `${part("hour")}:${part("minute")}`, auth.churchTimezone),
        ).toISOString();
        const { error: moveError } = await admin
          .from("plan_times")
          .update({ starts_at: startsAt })
          .eq("church_id", auth.churchId)
          .eq("id", t.id as string);
        if (moveError) throw moveError;
      }
    }

    revalidatePlans(plan.serviceTypeId, id);
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't save the plan.");
  }
}

/** Replaces the plan's times. `date` + `time` are local to the church. */
export async function updatePlanTimesAction(
  planId: string,
  times: { kind: TimeKind; label: string; date: string; time: string }[],
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await assertPlan(admin, auth.churchId, id);
    if (!Array.isArray(times) || times.length > 12) throw new UserFacingError("Keep to 12 times or fewer.");
    const rows = times.flatMap((t) => {
      const label = cleanText(t?.label, 60);
      if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(t?.date ?? "") || !/^\d{2}:\d{2}$/.test(t?.time ?? "")) return [];
      return [
        {
          church_id: auth.churchId,
          plan_id: id,
          kind: isTimeKind(t.kind) ? t.kind : "service",
          label,
          starts_at: new Date(zonedDateTimeToUtcMs(t.date, t.time, auth.churchTimezone)).toISOString(),
        },
      ];
    });
    if (!plan.isTemplate && !rows.some((r) => r.kind === "service")) {
      throw new UserFacingError("Keep at least one service time on the plan.");
    }
    const { error: delError } = await admin.from("plan_times").delete().eq("church_id", auth.churchId).eq("plan_id", id);
    if (delError) throw delError;
    if (rows.length) {
      const { error } = await admin.from("plan_times").insert(rows);
      if (error) throw error;
    }
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't save the service times.");
  }
}

export async function deletePlanAction(planId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await assertPlan(admin, auth.churchId, id);
    const { error } = await admin.from("plans").delete().eq("church_id", auth.churchId).eq("id", id);
    if (error) throw error;
    revalidatePlans(plan.serviceTypeId);
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't delete the plan.");
  }
}

export async function saveAsTemplateAction(planId: string, name: string): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    const plan = await assertPlan(admin, auth.churchId, id);
    const title = requireText(name, 120, "template");
    const { data: template, error } = await admin
      .from("plans")
      .insert({
        church_id: auth.churchId,
        service_type_id: plan.serviceTypeId,
        is_template: true,
        title,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: copyError } = await admin.rpc("service_plan_copy_contents", {
      p_church_id: auth.churchId,
      p_source_plan_id: id,
      p_target_plan_id: template.id,
    });
    if (copyError) {
      await admin.from("plans").delete().eq("church_id", auth.churchId).eq("id", template.id);
      throw copyError;
    }
    revalidatePlans(plan.serviceTypeId);
    return { ok: true, id: template.id as string };
  } catch (e) {
    return failed(e, "We couldn't save the template.");
  }
}

/** The plan as it is now, for the editor to catch up after someone else's edit. */
export async function getPlanAction(planId: string): Promise<Ok<{ plan: Plan }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const plan = await getPlan(admin, auth.churchId, assertId(planId));
    if (!plan) throw new UserFacingError("This plan was deleted.");
    return { ok: true, plan };
  } catch (e) {
    return failed(e, "We couldn't refresh the plan.");
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);
}

function cleanLength(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(86_400, Math.max(0, n)) : 0;
}

async function songFields(
  admin: ReturnType<typeof createAdminClient>,
  churchId: string,
  songId: string | null,
  arrangementId: string | null,
): Promise<{ song_id: string | null; arrangement_id: string | null; song_key: string | null; length: number | null; title: string | null }> {
  if (!songId) return { song_id: null, arrangement_id: null, song_key: null, length: null, title: null };
  const { data: song, error } = await admin
    .from("songs")
    .select("id, title, default_key")
    .eq("church_id", churchId)
    .eq("id", songId)
    .maybeSingle();
  if (error) throw error;
  if (!song) throw new UserFacingError("That song is no longer in the library.");
  let arrangement: Record<string, unknown> | null = null;
  const { data: arrangements, error: aError } = await admin
    .from("song_arrangements")
    .select("id, key, length_seconds")
    .eq("church_id", churchId)
    .eq("song_id", songId)
    .order("sort_order");
  if (aError) throw aError;
  arrangement = (arrangementId ? arrangements?.find((a) => a.id === arrangementId) : arrangements?.[0]) ?? null;
  return {
    song_id: songId,
    arrangement_id: (arrangement?.id as string | undefined) ?? null,
    song_key: (arrangement?.key as string | null | undefined) ?? (song.default_key as string | null) ?? null,
    length: (arrangement?.length_seconds as number | null | undefined) ?? null,
    title: song.title as string,
  };
}

export async function createItemAction(
  planId: string,
  input: {
    itemType: ItemType;
    title?: string;
    lengthSeconds?: number;
    /** Undefined: at the end. Null: at the top. */
    afterId?: string | null;
    songId?: string | null;
    arrangementId?: string | null;
  },
): Promise<Ok<{ id: string; position: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(planId);
    await assertPlan(admin, auth.churchId, id);
    const itemType = isItemType(input.itemType) ? input.itemType : "item";
    const song = itemType === "song"
      ? await songFields(admin, auth.churchId, optionalId(input.songId), optionalId(input.arrangementId))
      : { song_id: null, arrangement_id: null, song_key: null, length: null, title: null };
    const title =
      cleanText(input.title, 200) ??
      song.title ??
      { item: "New item", song: "New song", header: "New section", media: "Media" }[itemType];
    const length = itemType === "header" ? 0 : cleanLength(input.lengthSeconds ?? song.length ?? (itemType === "song" ? 300 : 120));
    const afterId = input.afterId === undefined ? undefined : optionalId(input.afterId);

    // Two planners adding at the same spot can compute the same key: retry
    // with the fresh order.
    for (let attempt = 0; attempt < 3; attempt++) {
      const positions = await planPositions(admin, auth.churchId, id);
      const position = keyAfter(positions, afterId);
      const { data, error } = await admin
        .from("plan_items")
        .insert({
          church_id: auth.churchId,
          plan_id: id,
          position,
          item_type: itemType,
          title,
          length_seconds: length,
          song_id: song.song_id,
          arrangement_id: song.arrangement_id,
          song_key: song.song_key,
          updated_by: auth.userId,
        })
        .select("id, position")
        .single();
      if (!error) {
        await rebalanceIfNeeded(admin, auth.churchId, id, position);
        return { ok: true, id: data.id as string, position: data.position as string };
      }
      if (!isUniqueViolation(error)) throw error;
    }
    throw new UserFacingError("Someone else is editing this spot. Please try again.");
  } catch (e) {
    return failed(e, "We couldn't add the item.");
  }
}

export type ItemPatch = {
  title?: string;
  itemType?: ItemType;
  lengthSeconds?: number;
  description?: string | null;
  mediaUrl?: string | null;
  songId?: string | null;
  arrangementId?: string | null;
  songKey?: string | null;
};

/** Writes only the fields given, so two people editing different fields both win. */
export async function updateItemAction(itemId: string, patch: ItemPatch): Promise<Ok<{ updatedAt: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(itemId);
    const item = await assertItem(admin, auth.churchId, id);
    const row: Record<string, unknown> = { updated_by: auth.userId };
    if (patch.title !== undefined) row.title = requireText(patch.title, 200, "item");
    const nextType = patch.itemType !== undefined && isItemType(patch.itemType) ? patch.itemType : null;
    if (nextType) {
      row.item_type = nextType;
      // Converting a song to an item keeps notes and description; the song
      // link goes. A header has no length.
      if (nextType !== "song") Object.assign(row, { song_id: null, arrangement_id: null, song_key: null });
      if (nextType === "header") row.length_seconds = 0;
    }
    const effectiveType = nextType ?? item.itemType;
    if (patch.lengthSeconds !== undefined && effectiveType !== "header") row.length_seconds = cleanLength(patch.lengthSeconds);
    if (patch.description !== undefined) row.description = cleanText(patch.description, 4000);
    if (patch.mediaUrl !== undefined) {
      const url = cleanText(patch.mediaUrl, 2048);
      if (url && !/^https:\/\//i.test(url)) throw new UserFacingError("Media links must start with https://");
      row.media_url = url;
    }
    if (patch.songId !== undefined && effectiveType === "song") {
      const song = await songFields(admin, auth.churchId, optionalId(patch.songId), optionalId(patch.arrangementId));
      Object.assign(row, { song_id: song.song_id, arrangement_id: song.arrangement_id, song_key: song.song_key });
    } else if (patch.arrangementId !== undefined && effectiveType === "song") {
      const { data: current } = await admin.from("plan_items").select("song_id").eq("church_id", auth.churchId).eq("id", id).single();
      const song = await songFields(admin, auth.churchId, (current?.song_id as string | null) ?? null, optionalId(patch.arrangementId));
      Object.assign(row, { arrangement_id: song.arrangement_id, song_key: song.song_key });
    }
    if (patch.songKey !== undefined) row.song_key = cleanText(patch.songKey, 8);

    const { data, error } = await admin
      .from("plan_items")
      .update(row)
      .eq("church_id", auth.churchId)
      .eq("id", id)
      .is("deleted_at", null)
      .select("updated_at")
      .single();
    if (error) throw error;
    return { ok: true, updatedAt: data.updated_at as string };
  } catch (e) {
    return failed(e, "We couldn't save the item.");
  }
}

export async function deleteItemAction(itemId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(itemId);
    await assertItem(admin, auth.churchId, id);
    const { error } = await admin
      .from("plan_items")
      .update({ deleted_at: new Date().toISOString(), updated_by: auth.userId })
      .eq("church_id", auth.churchId)
      .eq("id", id);
    if (error) throw error;
    // Items deleted more than 30 days ago are gone for good.
    await admin
      .from("plan_items")
      .delete()
      .eq("church_id", auth.churchId)
      .lt("deleted_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't delete the item.");
  }
}

export async function restoreItemAction(itemId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(itemId);
    const item = await assertItem(admin, auth.churchId, id, { includeDeleted: true });
    if (!item.deletedAt) return { ok: true };
    for (let attempt = 0; attempt < 3; attempt++) {
      // Its old spot may have been taken meanwhile; if so, put it just after.
      const positions = await planPositions(admin, auth.churchId, item.planId);
      const taken = positions.some((p) => p.position === item.position);
      const before = [...positions].reverse().find((p) => p.position < item.position);
      const position = taken ? keyAfter(positions, before?.id ?? null) : item.position;
      const { error } = await admin
        .from("plan_items")
        .update({ deleted_at: null, position, updated_by: auth.userId })
        .eq("church_id", auth.churchId)
        .eq("id", id);
      if (!error) return { ok: true };
      if (!isUniqueViolation(error)) throw error;
    }
    throw new UserFacingError("We couldn't put the item back. Please try again.");
  } catch (e) {
    return failed(e, "We couldn't restore the item.");
  }
}

/** Moves one item to just after `afterId` (null = to the top). One row written. */
export async function reorderItemAction(
  itemId: string,
  afterId: string | null,
): Promise<Ok<{ position: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(itemId);
    const after = optionalId(afterId);
    const item = await assertItem(admin, auth.churchId, id);
    for (let attempt = 0; attempt < 3; attempt++) {
      const positions = await planPositions(admin, auth.churchId, item.planId);
      const position = keyAfter(positions, after, id);
      const { error } = await admin
        .from("plan_items")
        .update({ position, updated_by: auth.userId })
        .eq("church_id", auth.churchId)
        .eq("id", id);
      if (!error) {
        await rebalanceIfNeeded(admin, auth.churchId, item.planId, position);
        return { ok: true, position };
      }
      if (!isUniqueViolation(error)) throw error;
    }
    throw new UserFacingError("Someone else moved items at the same time. Please try again.");
  } catch (e) {
    return failed(e, "We couldn't move the item.");
  }
}

export async function duplicateItemAction(itemId: string): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(itemId);
    const item = await assertItem(admin, auth.churchId, id);
    const { data: source, error } = await admin
      .from("plan_items")
      .select("item_type, title, length_seconds, description, song_id, arrangement_id, song_key, media_url")
      .eq("church_id", auth.churchId)
      .eq("id", id)
      .single();
    if (error) throw error;
    const positions = await planPositions(admin, auth.churchId, item.planId);
    const { data: copy, error: insError } = await admin
      .from("plan_items")
      .insert({
        ...source,
        church_id: auth.churchId,
        plan_id: item.planId,
        position: keyAfter(positions, id),
        updated_by: auth.userId,
      })
      .select("id")
      .single();
    if (insError) throw insError;

    const [{ data: leaders }, { data: notes }] = await Promise.all([
      admin.from("plan_item_leaders").select("person_id, team_position_id, sort_order").eq("church_id", auth.churchId).eq("plan_item_id", id),
      admin.from("plan_notes").select("category, body").eq("church_id", auth.churchId).eq("plan_item_id", id),
    ]);
    if (leaders?.length) {
      await admin.from("plan_item_leaders").insert(
        leaders.map((l) => ({ ...l, church_id: auth.churchId, plan_id: item.planId, plan_item_id: copy.id })),
      );
    }
    if (notes?.length) {
      await admin.from("plan_notes").insert(
        notes.map((n) => ({ ...n, church_id: auth.churchId, plan_id: item.planId, plan_item_id: copy.id, updated_by: auth.userId })),
      );
    }
    return { ok: true, id: copy.id as string };
  } catch (e) {
    return failed(e, "We couldn't duplicate the item.");
  }
}

export async function setItemLeadersAction(
  itemId: string,
  leaders: { personId?: string | null; teamPositionId?: string | null }[],
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const id = assertId(itemId);
    if (!Array.isArray(leaders) || leaders.length > 20) throw new UserFacingError("An item can have up to 20 leaders.");
    const clean = leaders.flatMap((l) => {
      const personId = optionalId(l?.personId);
      const teamPositionId = optionalId(l?.teamPositionId);
      return personId || teamPositionId ? [{ personId, teamPositionId }] : [];
    });
    const { error } = await admin.rpc("service_plan_set_item_leaders", {
      p_church_id: auth.churchId,
      p_item_id: id,
      p_leaders: clean,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't save who leads this item.");
  }
}

function isCategory(v: unknown): v is NoteCategory {
  return typeof v === "string" && (NOTE_CATEGORIES as readonly string[]).includes(v);
}

/** Saves one note category on the plan or an item. An empty note is removed. */
export async function upsertNoteAction(
  planId: string,
  itemId: string | null,
  category: NoteCategory,
  body: string,
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const plan = assertId(planId);
    const item = optionalId(itemId);
    if (!isCategory(category)) throw new UserFacingError("Pick a note category.");
    await assertPlan(admin, auth.churchId, plan);
    if (item) {
      const found = await assertItem(admin, auth.churchId, item);
      if (found.planId !== plan) throw new UserFacingError("That item is on a different plan.");
    }
    const text = typeof body === "string" ? body.trim().slice(0, 8000) : "";

    let del = admin.from("plan_notes").delete().eq("church_id", auth.churchId).eq("plan_id", plan).eq("category", category);
    del = item ? del.eq("plan_item_id", item) : del.is("plan_item_id", null);
    if (!text) {
      const { error } = await del;
      if (error) throw error;
      return { ok: true };
    }
    const { error } = await admin.from("plan_notes").upsert(
      {
        church_id: auth.churchId,
        plan_id: plan,
        plan_item_id: item,
        category,
        body: text,
        updated_by: auth.userId,
      },
      { onConflict: "plan_id,plan_item_id,category" },
    );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't save the note.");
  }
}

// ---------------------------------------------------------------------------
// Teams on a plan
// ---------------------------------------------------------------------------

export async function addPlanTeamMemberAction(
  planId: string,
  positionId: string,
  personId: string,
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const plan = await assertPlan(admin, auth.churchId, assertId(planId));
    const { error } = await admin.from("plan_team_members").upsert(
      {
        church_id: auth.churchId,
        plan_id: plan.id,
        team_position_id: assertId(positionId),
        person_id: assertId(personId),
      },
      { onConflict: "plan_id,team_position_id,person_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't add them to the team.");
  }
}

export async function setPlanTeamMemberStatusAction(
  memberId: string,
  status: TeamMemberStatus,
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    if (!(TEAM_MEMBER_STATUSES as readonly string[]).includes(status)) throw new UserFacingError("Pick a status.");
    const { data: member, error } = await admin
      .from("plan_team_members")
      .update({ status })
      .eq("church_id", auth.churchId)
      .eq("id", assertId(memberId))
      .select("plan_id, person_id")
      .maybeSingle();
    if (error) throw error;
    if (!member) throw new UserFacingError("We couldn't find them on this plan any more.");
    // Staff setting an answer by hand (after a phone call, say) is what the
    // person's own link shows too. No alert: staff made the change.
    const answer = admin.from("plan_attendance");
    const { error: answerError } =
      status === "unconfirmed"
        ? await answer
            .delete()
            .eq("church_id", auth.churchId)
            .eq("plan_id", member.plan_id as string)
            .eq("person_id", member.person_id as string)
        : await answer.upsert(
            {
              church_id: auth.churchId,
              plan_id: member.plan_id,
              person_id: member.person_id,
              status,
              share_id: null,
              responded_at: new Date().toISOString(),
            },
            { onConflict: "plan_id,person_id" },
          );
    if (answerError) throw answerError;
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't update their status.");
  }
}

export async function removePlanTeamMemberAction(memberId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const { error } = await admin
      .from("plan_team_members")
      .delete()
      .eq("church_id", auth.churchId)
      .eq("id", assertId(memberId));
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't take them off the team.");
  }
}

// ---------------------------------------------------------------------------
// Teams and positions (service type settings)
// ---------------------------------------------------------------------------

async function assertTeam(admin: ReturnType<typeof createAdminClient>, churchId: string, teamId: string) {
  const { data, error } = await admin
    .from("teams")
    .select("id, service_type_id")
    .eq("church_id", churchId)
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError("We couldn't find that team.");
  return { id: data.id as string, serviceTypeId: data.service_type_id as string };
}

export async function createTeamAction(serviceTypeId: string, name: string): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const typeId = assertId(serviceTypeId);
    await assertServiceType(admin, auth.churchId, typeId);
    const teamName = requireText(name, 60, "team");
    const id = await insertTeam(admin, auth.churchId, typeId, teamName, [], defaultCategoriesForTeam(teamName), 100);
    revalidatePlans(typeId);
    return { ok: true, id };
  } catch (e) {
    return failed(e, "We couldn't add the team.");
  }
}

export async function updateTeamAction(
  teamId: string,
  input: { name?: string; noteCategories?: NoteCategory[] },
): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const team = await assertTeam(admin, auth.churchId, assertId(teamId));
    if (input.name !== undefined) {
      const { error } = await admin
        .from("teams")
        .update({ name: requireText(input.name, 60, "team") })
        .eq("church_id", auth.churchId)
        .eq("id", team.id);
      if (error) throw error;
    }
    if (input.noteCategories !== undefined) {
      const categories = [...new Set(input.noteCategories.filter(isCategory))];
      const { error: delError } = await admin
        .from("team_note_categories")
        .delete()
        .eq("church_id", auth.churchId)
        .eq("team_id", team.id);
      if (delError) throw delError;
      if (categories.length) {
        const { error } = await admin
          .from("team_note_categories")
          .insert(categories.map((category) => ({ church_id: auth.churchId, team_id: team.id, category })));
        if (error) throw error;
      }
    }
    revalidatePlans(team.serviceTypeId);
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't save the team.");
  }
}

export async function archiveTeamAction(teamId: string, archived: boolean): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const team = await assertTeam(admin, auth.churchId, assertId(teamId));
    const { error } = await admin
      .from("teams")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("church_id", auth.churchId)
      .eq("id", team.id);
    if (error) throw error;
    revalidatePlans(team.serviceTypeId);
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't remove the team.");
  }
}

export async function addPositionAction(teamId: string, name: string): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const team = await assertTeam(admin, auth.churchId, assertId(teamId));
    const { data, error } = await admin
      .from("team_positions")
      .insert({ church_id: auth.churchId, team_id: team.id, name: requireText(name, 60, "position"), sort_order: 100 })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePlans(team.serviceTypeId);
    return { ok: true, id: data.id as string };
  } catch (e) {
    return failed(e, "We couldn't add the position.");
  }
}

export async function removePositionAction(positionId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const { error } = await admin
      .from("team_positions")
      .delete()
      .eq("church_id", auth.churchId)
      .eq("id", assertId(positionId));
    if (error) throw error;
    revalidatePlans();
    return { ok: true };
  } catch (e) {
    return failed(e, "We couldn't remove the position.");
  }
}

export async function createTemplateAction(serviceTypeId: string, name: string): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const typeId = assertId(serviceTypeId);
    await assertServiceType(admin, auth.churchId, typeId);
    const { data, error } = await admin
      .from("plans")
      .insert({
        church_id: auth.churchId,
        service_type_id: typeId,
        is_template: true,
        title: requireText(name, 120, "template"),
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePlans(typeId);
    return { ok: true, id: data.id as string };
  } catch (e) {
    return failed(e, "We couldn't create the template.");
  }
}
