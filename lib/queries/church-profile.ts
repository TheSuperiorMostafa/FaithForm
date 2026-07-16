import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultOfficeHours,
  formatOfficeHoursText,
  normalizeOfficeHours,
} from "@/lib/utils/office-hours";
import { createClient } from "@/lib/supabase/server";
import type {
  AiKnowledge,
  ChurchProfile,
  ChurchProfileFormState,
  ChurchServiceTime,
  ChurchStaffMember,
  ServiceTimeFormRow,
  StaffFormRow,
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

function mapChurchRow(
  row: Record<string, unknown>,
  serviceTimes: ChurchServiceTime[],
  staff: ChurchStaffMember[],
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
    slug: (row.slug as string | null) ?? null,
    stripeChargesEnabled: Boolean(row.stripe_charges_enabled),
    aiKnowledge: normalizeAiKnowledge(row.ai_knowledge),
    serviceTimes,
    staff,
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
    slug: null,
    stripeChargesEnabled: false,
    aiKnowledge: {},
    serviceTimes: [],
    staff: [],
  });
}

export async function getChurchProfile(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<ChurchProfile | null> {
  const client = supabase ?? db();

  const [churchResult, serviceResult, staffResult] = await Promise.all([
    client.from("churches").select(CHURCH_SELECT).eq("id", churchId).maybeSingle(),
    client
      .from("church_service_times")
      .select("*")
      .eq("church_id", churchId)
      .order("sort_order", { ascending: true }),
    client
      .from("church_staff")
      .select("*")
      .eq("church_id", churchId)
      .order("sort_order", { ascending: true }),
  ]);

  if (!churchResult.data) return null;

  const serviceTimes = (serviceResult.data ?? []).map((row) =>
    mapServiceTime(row as Record<string, unknown>),
  );
  const staff = (staffResult.data ?? []).map((row) =>
    mapStaff(row as Record<string, unknown>),
  );

  return mapChurchRow(
    churchResult.data as Record<string, unknown>,
    serviceTimes,
    staff,
  );
}

export type UpsertChurchProfileInput = Omit<
  ChurchProfileFormState,
  "serviceTimes" | "staff"
> & {
  serviceTimes: ServiceTimeFormRow[];
  staff: StaffFormRow[];
};

function cleanOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export async function upsertChurchProfile(
  churchId: string,
  input: UpsertChurchProfileInput,
  supabase: SupabaseClient,
): Promise<ChurchProfile> {
  const { error: churchError } = await supabase
    .from("churches")
    .update({
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
      ai_knowledge: input.aiKnowledge,
    })
    .eq("id", churchId);

  if (churchError) throw churchError;

  // Mirror denomination to church_settings for backward compatibility
  await supabase.from("church_settings").upsert(
    {
      church_id: churchId,
      denomination: cleanOptional(input.denomination),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id" },
  );

  // Sync phone + office hours to voice_assistant_settings for legacy readers
  await supabase.from("voice_assistant_settings").upsert(
    {
      church_id: churchId,
      church_phone: cleanOptional(input.phone),
      office_hours: input.officeHours,
      denomination: cleanOptional(input.denomination),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id", ignoreDuplicates: false },
  );

  await syncServiceTimes(churchId, input.serviceTimes, supabase);
  await syncStaff(churchId, input.staff, supabase);

  const profile = await getChurchProfile(churchId, supabase);
  if (!profile) throw new Error("Failed to load church profile after save.");
  return profile;
}

async function syncServiceTimes(
  churchId: string,
  rows: ServiceTimeFormRow[],
  supabase: SupabaseClient,
) {
  const { data: existing } = await supabase
    .from("church_service_times")
    .select("id")
    .eq("church_id", churchId);

  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  const keptIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.label.trim()) continue;

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

    if (row.id && existingIds.has(row.id)) {
      keptIds.add(row.id);
      const { error } = await supabase
        .from("church_service_times")
        .update(payload)
        .eq("id", row.id)
        .eq("church_id", churchId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("church_service_times")
        .insert(payload)
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
  supabase: SupabaseClient,
) {
  const { data: existing } = await supabase
    .from("church_staff")
    .select("id")
    .eq("church_id", churchId);

  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  const keptIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.fullName.trim()) continue;

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

    if (row.id && existingIds.has(row.id)) {
      keptIds.add(row.id);
      const { error } = await supabase
        .from("church_staff")
        .update(payload)
        .eq("id", row.id)
        .eq("church_id", churchId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("church_staff")
        .insert(payload)
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
