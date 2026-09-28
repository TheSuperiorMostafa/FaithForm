import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultOfficeHours,
  formatOfficeHoursText,
  normalizeOfficeHours,
} from "@/lib/utils/office-hours";
import { createClient } from "@/lib/supabase/server";
import { formatAnnouncementFacebookPostTime } from "@/lib/integrations/facebook";
import { readAllById } from "@/lib/queries/paged-read";
import type {
  AiKnowledge,
  ChurchProfile,
  ChurchProfileFormState,
  ChurchRecurringEvent,
  ChurchServiceTime,
  ChurchStaffMember,
  ServiceTimeFormRow,
  StaffFormRow,
  RecurringEventFormRow,
} from "@/types/church-profile";
import type { VoiceProfileSummary } from "@/types/voice-assistant";

const CHURCH_SELECT = `
  id,
  name,
  tagline,
  mission_statement,
  vision_statement,
  description,
  logo_url,
  cover_image_url,
  giving_primary_color,
  giving_accent_color,
  address,
  city,
  state,
  zip,
  phone,
  email,
  website,
  google_maps_url,
  timezone,
  denomination,
  office_hours,
  holiday_schedule,
  facebook_url,
  instagram_url,
  youtube_url,
  tiktok_url,
  x_url,
  podcast_url,
  livestream_url,
  announcement_facebook_post_time,
  slug,
  stripe_charges_enabled,
  ai_knowledge
`;

function db() {
  return createClient();
}

function normalizeAiKnowledge(raw: unknown): AiKnowledge {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const result: AiKnowledge = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim()) {
      result[key as keyof AiKnowledge] = value.trim();
    }
  }
  return result;
}

function mapServiceTime(row: Record<string, unknown>): ChurchServiceTime {
  return {
    id: row.id as string,
    church_id: row.church_id as string,
    label: row.label as string,
    day_of_week: row.day_of_week as number,
    start_time: String(row.start_time).slice(0, 5),
    end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
    kind: row.kind as ChurchServiceTime["kind"],
    notes: (row.notes as string | null) ?? null,
    sort_order: (row.sort_order as number) ?? 0,
  };
}

function mapStaff(row: Record<string, unknown>): ChurchStaffMember {
  return {
    id: row.id as string,
    church_id: row.church_id as string,
    full_name: row.full_name as string,
    title: (row.title as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    photo_url: (row.photo_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    is_senior_pastor: Boolean(row.is_senior_pastor),
    is_executive_pastor: Boolean(row.is_executive_pastor),
    ai_contact_priority: (row.ai_contact_priority as number) ?? 0,
    sort_order: (row.sort_order as number) ?? 0,
    is_public: row.is_public !== false,
  };
}

function mapRecurringEvent(row: Record<string, unknown>): ChurchRecurringEvent {
  return {
    id: row.id as string,
    church_id: row.church_id as string,
    name: row.name as string,
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((v): v is string => typeof v === "string") : [],
    cadence: (row.cadence as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    audience: (row.audience as string | null) ?? null,
    tone: (row.tone as string | null) ?? null,
    caption_notes: (row.caption_notes as string | null) ?? null,
    visual_notes: (row.visual_notes as string | null) ?? null,
    is_active: row.is_active !== false,
    sort_order: (row.sort_order as number) ?? 0,
  };
}

function mapChurchRow(
  row: Record<string, unknown>,
  serviceTimes: ChurchServiceTime[],
  staff: ChurchStaffMember[],
  recurringEvents: ChurchRecurringEvent[],
): ChurchProfile {
  return {
    churchId: row.id as string,
    name: row.name as string,
    tagline: (row.tagline as string | null) ?? null,
    missionStatement: (row.mission_statement as string | null) ?? null,
    visionStatement: (row.vision_statement as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    coverImageUrl: (row.cover_image_url as string | null) ?? null,
    primaryColor: (row.giving_primary_color as string | null) ?? null,
    accentColor: (row.giving_accent_color as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    zip: (row.zip as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    googleMapsUrl: (row.google_maps_url as string | null) ?? null,
    timezone: (row.timezone as string) ?? "America/New_York",
    denomination: (row.denomination as string | null) ?? null,
    officeHours: normalizeOfficeHours(row.office_hours),
    holidaySchedule: (row.holiday_schedule as string | null) ?? null,
    facebookUrl: (row.facebook_url as string | null) ?? null,
    instagramUrl: (row.instagram_url as string | null) ?? null,
    youtubeUrl: (row.youtube_url as string | null) ?? null,
    tiktokUrl: (row.tiktok_url as string | null) ?? null,
    xUrl: (row.x_url as string | null) ?? null,
    podcastUrl: (row.podcast_url as string | null) ?? null,
    livestreamUrl: (row.livestream_url as string | null) ?? null,
    announcementFacebookPostTime: formatAnnouncementFacebookPostTime(
      row.announcement_facebook_post_time
        ? String(row.announcement_facebook_post_time).slice(0, 5)
        : null,
    ),
    slug: (row.slug as string | null) ?? null,
    stripeChargesEnabled: Boolean(row.stripe_charges_enabled),
    aiKnowledge: normalizeAiKnowledge(row.ai_knowledge),
    serviceTimes,
    staff,
    recurringEvents,
  };
}

export function profileToFormState(profile: ChurchProfile): ChurchProfileFormState {
  return {
    name: profile.name,
    tagline: profile.tagline ?? "",
    missionStatement: profile.missionStatement ?? "",
    visionStatement: profile.visionStatement ?? "",
    description: profile.description ?? "",
    logoUrl: profile.logoUrl ?? "",
    coverImageUrl: profile.coverImageUrl ?? "",
    primaryColor: profile.primaryColor ?? "",
    accentColor: profile.accentColor ?? "",
    address: profile.address ?? "",
    city: profile.city ?? "",
    state: profile.state ?? "",
    zip: profile.zip ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    website: profile.website ?? "",
    googleMapsUrl: profile.googleMapsUrl ?? "",
    timezone: profile.timezone,
    denomination: profile.denomination ?? "",
    officeHours: profile.officeHours,
    holidaySchedule: profile.holidaySchedule ?? "",
    facebookUrl: profile.facebookUrl ?? "",
    instagramUrl: profile.instagramUrl ?? "",
    youtubeUrl: profile.youtubeUrl ?? "",
    tiktokUrl: profile.tiktokUrl ?? "",
    xUrl: profile.xUrl ?? "",
    podcastUrl: profile.podcastUrl ?? "",
    livestreamUrl: profile.livestreamUrl ?? "",
    announcementFacebookPostTime: profile.announcementFacebookPostTime,
    aiKnowledge: { ...profile.aiKnowledge },
    serviceTimes: profile.serviceTimes.map((st) => ({
      clientId: st.id,
      id: st.id,
      label: st.label,
      dayOfWeek: st.day_of_week,
      startTime: st.start_time,
      endTime: st.end_time ?? "",
      kind: st.kind,
      notes: st.notes ?? "",
    })),
    staff: profile.staff.map((s) => ({
      clientId: s.id,
      id: s.id,
      fullName: s.full_name,
      title: s.title ?? "",
      email: s.email ?? "",
      phone: s.phone ?? "",
      photoUrl: s.photo_url ?? "",
      bio: s.bio ?? "",
      isSeniorPastor: s.is_senior_pastor,
      isExecutivePastor: s.is_executive_pastor,
      aiContactPriority: s.ai_contact_priority,
      isPublic: s.is_public,
    })),
    recurringEvents: profile.recurringEvents.map((event) => ({
      clientId: event.id,
      id: event.id,
      name: event.name,
      aliases: event.aliases.join(", "),
      cadence: event.cadence ?? "",
      description: event.description ?? "",
      audience: event.audience ?? "",
      tone: event.tone ?? "",
      captionNotes: event.caption_notes ?? "",
      visualNotes: event.visual_notes ?? "",
      isActive: event.is_active,
    })),
  };
}

export function emptyChurchProfileForm(churchName = ""): ChurchProfileFormState {
  return profileToFormState({
    churchId: "",
    name: churchName,
    tagline: null,
    missionStatement: null,
    visionStatement: null,
    description: null,
    logoUrl: null,
    coverImageUrl: null,
    primaryColor: null,
    accentColor: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    email: null,
    website: null,
    googleMapsUrl: null,
    timezone: "America/New_York",
    denomination: null,
    officeHours: defaultOfficeHours(),
    holidaySchedule: null,
    facebookUrl: null,
    instagramUrl: null,
    youtubeUrl: null,
    tiktokUrl: null,
    xUrl: null,
    podcastUrl: null,
    livestreamUrl: null,
    announcementFacebookPostTime: "09:00",
    slug: null,
    stripeChargesEnabled: false,
    aiKnowledge: {},
    serviceTimes: [],
    staff: [],
    recurringEvents: [],
  });
}

export async function getChurchProfile(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<ChurchProfile | null> {
  const client = supabase ?? db();

  const loadChildren = (table: "church_service_times" | "church_staff" | "church_recurring_events") =>
    readAllById<{ id: string; sort_order?: number } & Record<string, unknown>>(
      async (afterId, includeCount, pageSize) => {
        let query = client
          .from(table)
          .select("*", { count: includeCount ? "exact" : undefined })
          .eq("church_id", churchId);
        if (afterId) query = query.gt("id", afterId);
        return await query.order("id").limit(pageSize);
      },
      { label: table, maxRows: 10_000 },
    ).then((rows) => rows.sort((a, b) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.id.localeCompare(b.id),
    ));

  const [churchResult, serviceResult, staffResult, recurringEventsResult] = await Promise.all([
    client.from("churches").select(CHURCH_SELECT).eq("id", churchId).maybeSingle(),
    loadChildren("church_service_times"),
    loadChildren("church_staff"),
    loadChildren("church_recurring_events"),
  ]);

  if (churchResult.error) throw new Error(`church profile: ${churchResult.error.message}`);
  if (!churchResult.data) return null;

  const serviceTimes = serviceResult.map(mapServiceTime);
  const staff = staffResult.map(mapStaff);
  const recurringEvents = recurringEventsResult.map(mapRecurringEvent);

  return mapChurchRow(
    churchResult.data as Record<string, unknown>,
    serviceTimes,
    staff,
    recurringEvents,
  );
}

export type UpsertChurchProfileInput = Omit<
  ChurchProfileFormState,
  "serviceTimes" | "staff" | "recurringEvents"
> & {
  serviceTimes: ServiceTimeFormRow[];
  staff: StaffFormRow[];
  recurringEvents: RecurringEventFormRow[];
};

function cleanOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function targetChildId(row: { id?: string; clientId: string }, existingIds: Set<string>): string | null {
  if (row.id) {
    if (!existingIds.has(row.id)) throw new Error("A profile row changed since this form opened. Refresh and try again.");
    return row.id;
  }
  return UUID_PATTERN.test(row.clientId) ? row.clientId : null;
}

function atomicChildId(row: { id?: string; clientId: string }): string {
  if (row.id) {
    if (!UUID_PATTERN.test(row.id)) throw new Error("Invalid saved profile row ID.");
    return row.id;
  }
  return UUID_PATTERN.test(row.clientId) ? row.clientId : crypto.randomUUID();
}

export async function upsertChurchProfile(
  churchId: string,
  input: UpsertChurchProfileInput,
  supabase: SupabaseClient,
): Promise<ChurchProfile> {
  const churchPatch = {
    name: input.name.trim(),
    tagline: cleanOptional(input.tagline),
    mission_statement: cleanOptional(input.missionStatement),
    vision_statement: cleanOptional(input.visionStatement),
    description: cleanOptional(input.description),
    logo_url: cleanOptional(input.logoUrl),
    cover_image_url: cleanOptional(input.coverImageUrl),
    giving_primary_color: cleanOptional(input.primaryColor),
    giving_accent_color: cleanOptional(input.accentColor),
    address: cleanOptional(input.address),
    city: cleanOptional(input.city),
    state: cleanOptional(input.state),
    zip: cleanOptional(input.zip),
    phone: cleanOptional(input.phone),
    email: cleanOptional(input.email),
    website: cleanOptional(input.website),
    google_maps_url: cleanOptional(input.googleMapsUrl),
    timezone: input.timezone.trim() || "America/New_York",
    denomination: cleanOptional(input.denomination),
    office_hours: input.officeHours,
    holiday_schedule: cleanOptional(input.holidaySchedule),
    facebook_url: cleanOptional(input.facebookUrl),
    instagram_url: cleanOptional(input.instagramUrl),
    youtube_url: cleanOptional(input.youtubeUrl),
    tiktok_url: cleanOptional(input.tiktokUrl),
    x_url: cleanOptional(input.xUrl),
    podcast_url: cleanOptional(input.podcastUrl),
    livestream_url: cleanOptional(input.livestreamUrl),
    announcement_facebook_post_time: input.announcementFacebookPostTime,
    ai_knowledge: input.aiKnowledge,
  };
  const services = input.serviceTimes.filter((row) => row.label.trim()).map((row, index) => ({
    id: atomicChildId(row),
    is_existing: Boolean(row.id),
    label: row.label.trim(),
    day_of_week: row.dayOfWeek,
    start_time: row.startTime,
    end_time: cleanOptional(row.endTime),
    kind: row.kind,
    notes: cleanOptional(row.notes),
    sort_order: index,
  }));
  const staff = input.staff.filter((row) => row.fullName.trim()).map((row, index) => ({
    id: atomicChildId(row),
    is_existing: Boolean(row.id),
    full_name: row.fullName.trim(),
    title: cleanOptional(row.title),
    email: cleanOptional(row.email),
    phone: cleanOptional(row.phone),
    photo_url: cleanOptional(row.photoUrl),
    bio: cleanOptional(row.bio),
    is_senior_pastor: row.isSeniorPastor,
    is_executive_pastor: row.isExecutivePastor,
    ai_contact_priority: row.aiContactPriority,
    is_public: row.isPublic,
    sort_order: index,
  }));
  const events = input.recurringEvents.filter((row) => row.name.trim()).map((row, index) => ({
    id: atomicChildId(row),
    is_existing: Boolean(row.id),
    name: row.name.trim(),
    aliases: row.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    cadence: cleanOptional(row.cadence),
    description: cleanOptional(row.description),
    audience: cleanOptional(row.audience),
    tone: cleanOptional(row.tone),
    caption_notes: cleanOptional(row.captionNotes),
    visual_notes: cleanOptional(row.visualNotes),
    is_active: row.isActive,
    sort_order: index,
  }));

  const atomic = await supabase.rpc("save_church_profile", {
    p_church_id: churchId,
    p_church: churchPatch,
    p_services: services,
    p_staff: staff,
    p_events: events,
  });
  if (!atomic.error) {
    const profile = await getChurchProfile(churchId, supabase);
    if (!profile) throw new Error("Failed to load church profile after save.");
    return profile;
  }
  if (!/PGRST202|42883|could not find the function/i.test(atomic.error.message)) {
    throw new Error(`Church profile save failed: ${atomic.error.message}`);
  }

  // Narrow deployment window before 0122 reaches the database. The legacy
  // path remains guarded by counted preflight reads and checked writes.
  // These lists decide which old rows are removed. Confirm every list is
  // complete before changing the church or any child row.
  const [serviceIds, staffIds, recurringEventIds] = await Promise.all([
    readExistingChildIds("church_service_times", churchId, supabase),
    readExistingChildIds("church_staff", churchId, supabase),
    readExistingChildIds("church_recurring_events", churchId, supabase),
  ]);

  const { data: updatedChurch, error: churchError } = await supabase
    .from("churches")
    .update(churchPatch)
    .eq("id", churchId)
    .select("id")
    .maybeSingle();

  if (churchError) throw churchError;
  if (!updatedChurch) throw new Error("Church profile update changed no row.");

  // Mirror denomination to church_settings for backward compatibility
  const { error: settingsError } = await supabase.from("church_settings").upsert(
    {
      church_id: churchId,
      denomination: cleanOptional(input.denomination),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id" },
  );
  if (settingsError) throw settingsError;

  // Sync phone + office hours to voice_assistant_settings for legacy readers
  const { error: voiceError } = await supabase.from("voice_assistant_settings").upsert(
    {
      church_id: churchId,
      church_phone: cleanOptional(input.phone),
      office_hours: input.officeHours,
      denomination: cleanOptional(input.denomination),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id", ignoreDuplicates: false },
  );
  if (voiceError) throw voiceError;

  await syncServiceTimes(churchId, input.serviceTimes, serviceIds, supabase);
  await syncStaff(churchId, input.staff, staffIds, supabase);
  await syncRecurringEvents(churchId, input.recurringEvents, recurringEventIds, supabase);

  const profile = await getChurchProfile(churchId, supabase);
  if (!profile) throw new Error("Failed to load church profile after save.");
  return profile;
}

async function readExistingChildIds(
  table: "church_service_times" | "church_staff" | "church_recurring_events",
  churchId: string,
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const rows = await readAllById<{ id: string }>(
    async (afterId, includeCount, pageSize) => {
      let query = supabase
        .from(table)
        .select("id", { count: includeCount ? "exact" : undefined })
        .eq("church_id", churchId);
      if (afterId) query = query.gt("id", afterId);
      return await query.order("id").limit(pageSize);
    },
    { label: `${table} before profile save`, maxRows: 10_000 },
  );
  return new Set(rows.map((row) => row.id));
}

async function syncRecurringEvents(
  churchId: string,
  rows: RecurringEventFormRow[],
  existingIds: Set<string>,
  supabase: SupabaseClient,
) {
  const keptIds = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.name.trim()) continue;
    const targetId = targetChildId(row, existingIds);
    const payload = {
      church_id: churchId,
      name: row.name.trim(),
      aliases: row.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
      cadence: cleanOptional(row.cadence),
      description: cleanOptional(row.description),
      audience: cleanOptional(row.audience),
      tone: cleanOptional(row.tone),
      caption_notes: cleanOptional(row.captionNotes),
      visual_notes: cleanOptional(row.visualNotes),
      is_active: row.isActive,
      sort_order: i,
    };

    if (targetId && existingIds.has(targetId)) {
      keptIds.add(targetId);
      const { data, error } = await supabase
        .from("church_recurring_events")
        .update(payload)
        .eq("id", targetId)
        .eq("church_id", churchId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("A recurring event changed while saving.");
    } else {
      const { data, error } = await supabase
        .from("church_recurring_events")
        .insert({ ...payload, ...(targetId ? { id: targetId } : {}) })
        .select("id")
        .single();
      if (error) throw error;
      keptIds.add(data.id as string);
    }
  }

  const toDelete = Array.from(existingIds).filter((id) => !keptIds.has(id));
  if (toDelete.length) {
    const { error } = await supabase
      .from("church_recurring_events")
      .delete()
      .in("id", toDelete)
      .eq("church_id", churchId);
    if (error) throw error;
  }
}

export async function getChurchAnnouncementFacebookSchedule(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ timezone: string; postTime: string }> {
  const client = supabase ?? db();
  const { data, error } = await client
    .from("churches")
    .select("timezone, announcement_facebook_post_time")
    .eq("id", churchId)
    .maybeSingle();

  if (error || !data) {
    return {
      timezone: "America/New_York",
      postTime: formatAnnouncementFacebookPostTime(null),
    };
  }

  return {
    timezone: (data.timezone as string) || "America/New_York",
    postTime: formatAnnouncementFacebookPostTime(
      data.announcement_facebook_post_time
        ? String(data.announcement_facebook_post_time).slice(0, 5)
        : null,
    ),
  };
}

async function syncServiceTimes(
  churchId: string,
  rows: ServiceTimeFormRow[],
  existingIds: Set<string>,
  supabase: SupabaseClient,
) {
  const keptIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.label.trim()) continue;
    const targetId = targetChildId(row, existingIds);

    const payload = {
      church_id: churchId,
      label: row.label.trim(),
      day_of_week: row.dayOfWeek,
      start_time: row.startTime,
      end_time: row.endTime.trim() || null,
      kind: row.kind,
      notes: cleanOptional(row.notes),
      sort_order: i,
      updated_at: new Date().toISOString(),
    };

    if (targetId && existingIds.has(targetId)) {
      keptIds.add(targetId);
      const { data, error } = await supabase
        .from("church_service_times")
        .update(payload)
        .eq("id", targetId)
        .eq("church_id", churchId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("A service time changed while saving.");
    } else {
      const { data, error } = await supabase
        .from("church_service_times")
        .insert({ ...payload, ...(targetId ? { id: targetId } : {}) })
        .select("id")
        .single();
      if (error) throw error;
      keptIds.add(data.id as string);
    }
  }

  const toDelete = Array.from(existingIds).filter((id) => !keptIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("church_service_times")
      .delete()
      .in("id", toDelete)
      .eq("church_id", churchId);
    if (error) throw error;
  }
}

async function syncStaff(
  churchId: string,
  rows: StaffFormRow[],
  existingIds: Set<string>,
  supabase: SupabaseClient,
) {
  const keptIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.fullName.trim()) continue;
    const targetId = targetChildId(row, existingIds);

    const payload = {
      church_id: churchId,
      full_name: row.fullName.trim(),
      title: cleanOptional(row.title),
      email: cleanOptional(row.email),
      phone: cleanOptional(row.phone),
      photo_url: cleanOptional(row.photoUrl),
      bio: cleanOptional(row.bio),
      is_senior_pastor: row.isSeniorPastor,
      is_executive_pastor: row.isExecutivePastor,
      ai_contact_priority: row.aiContactPriority,
      is_public: row.isPublic,
      sort_order: i,
      updated_at: new Date().toISOString(),
    };

    if (targetId && existingIds.has(targetId)) {
      keptIds.add(targetId);
      const { data, error } = await supabase
        .from("church_staff")
        .update(payload)
        .eq("id", targetId)
        .eq("church_id", churchId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("A staff entry changed while saving.");
    } else {
      const { data, error } = await supabase
        .from("church_staff")
        .insert({ ...payload, ...(targetId ? { id: targetId } : {}) })
        .select("id")
        .single();
      if (error) throw error;
      keptIds.add(data.id as string);
    }
  }

  const toDelete = Array.from(existingIds).filter((id) => !keptIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("church_staff")
      .delete()
      .in("id", toDelete)
      .eq("church_id", churchId);
    if (error) throw error;
  }
}

export function formatServiceTimeLine(st: ChurchServiceTime): string {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][st.day_of_week] ?? "?";
  const end = st.end_time ? ` – ${formatTime12(st.end_time)}` : "";
  const notes = st.notes?.trim() ? ` (${st.notes.trim()})` : "";
  return `${st.label}: ${day} ${formatTime12(st.start_time)}${end}${notes}`;
}

function formatTime12(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  if (Number.isNaN(h)) return time;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m} ${period}`;
}

export function formatStaffLine(member: ChurchStaffMember): string {
  const parts = [member.full_name];
  if (member.title?.trim()) parts.push(member.title.trim());
  if (member.phone?.trim()) parts.push(member.phone.trim());
  else if (member.email?.trim()) parts.push(member.email.trim());
  if (member.is_senior_pastor) parts.push("Senior Pastor");
  return parts.join(" — ");
}

export function formatOfficeHoursFromProfile(
  officeHours: ChurchProfile["officeHours"],
): string {
  return formatOfficeHoursText(officeHours);
}

export function buildVoiceProfileSummary(
  profile: ChurchProfile,
  churchName: string,
  assistantName: string,
): VoiceProfileSummary {
  const greetingFromProfile = profile.aiKnowledge.greeting?.trim();
  const defaultGreeting = `Hi, you've reached ${churchName}. This is ${assistantName || "the church desk"}.`;

  return {
    denomination: profile.denomination ?? "",
    churchPhone: profile.phone ?? "",
    greetingMessage: greetingFromProfile || defaultGreeting,
    hasOpenOfficeDay: Object.values(profile.officeHours).some((d) => d.enabled),
  };
}
