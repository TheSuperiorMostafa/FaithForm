import type { SupabaseClient } from "@supabase/supabase-js";
import { listChurchCalendarEvents } from "@/lib/integrations/calendar";
import {
  replaceAssistantNameInText,
  withRecordingDisclosure,
} from "@/lib/integrations/retell-prompt";
import { getPublishedAnnouncements } from "@/lib/queries/announcements";
import {
  formatServiceTimeLine,
  formatStaffLine,
  getChurchProfile,
} from "@/lib/queries/church-profile";
import { createClient } from "@/lib/supabase/server";
import type {
  AgentMode,
  DayKey,
  OfficeHours,
  PhoneCallRow,
  SpeakingPace,
  VoiceAssistantContext,
  VoiceAssistantFormState,
  VoiceAgentSyncStatus,
  VoiceAssistantSettings,
  VoiceGender,
  VoiceTone,
} from "@/types/voice-assistant";
import type { AiKnowledge } from "@/types/church-profile";

import {
  defaultOfficeHours,
  normalizeOfficeHours,
} from "@/lib/utils/office-hours";

export { defaultOfficeHours, normalizeOfficeHours };

const SERVICE_KEYWORDS = [
  "worship",
  "service",
  "sunday",
  "mass",
  "liturgy",
  "prayer meeting",
  "midweek",
];

const PROGRAM_KEYWORDS = [
  "youth",
  "bible study",
  "group",
  "ministry",
  "class",
  "fellowship",
  "volunteer",
  "small group",
  "awana",
  "vbs",
];

function db() {
  return createClient();
}

function mapSettings(row: Record<string, unknown>): VoiceAssistantSettings {
  return {
    church_id: row.church_id as string,
    assistant_name: (row.assistant_name as string | null) ?? null,
    denomination: (row.denomination as string | null) ?? null,
    church_phone: (row.church_phone as string | null) ?? null,
    emergency_phone: (row.emergency_phone as string | null) ?? null,
    tone: (row.tone as VoiceTone) ?? "warm_friendly",
    speaking_pace: (row.speaking_pace as SpeakingPace) ?? "normal",
    voice_gender: (row.voice_gender as VoiceGender) === "female" ? "female" : "male",
    language: (row.language as string) ?? "en",
    greeting_message: (row.greeting_message as string | null) ?? null,
    signoff_message: (row.signoff_message as string | null) ?? null,
    office_hours: normalizeOfficeHours(row.office_hours),
    after_hours_enabled: Boolean(row.after_hours_enabled),
    after_hours_message: (row.after_hours_message as string | null) ?? null,
    retell_llm_id: (row.retell_llm_id as string | null) ?? null,
    retail_ai_agent_id: (row.retail_ai_agent_id as string | null) ?? null,
    retail_ai_phone_number: (row.retail_ai_phone_number as string | null) ?? null,
    agent_synced_at: (row.agent_synced_at as string | null) ?? null,
    agent_mode: (row.agent_mode as AgentMode) === "linked" ? "linked" : "managed",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getVoiceAssistantSettings(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<VoiceAssistantSettings | null> {
  const client = supabase ?? db();
  const { data } = await client
    .from("voice_assistant_settings")
    .select("*")
    .eq("church_id", churchId)
    .maybeSingle();

  if (!data) return null;
  return mapSettings(data);
}

export type ChurchProfileForVoice = {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
  slug: string | null;
  stripeChargesEnabled: boolean;
  denomination: string | null;
  officeHours: OfficeHours;
  aiKnowledge: AiKnowledge;
  holidaySchedule: string | null;
};

export async function getChurchProfileForVoice(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<ChurchProfileForVoice | null> {
  const profile = await getChurchProfile(churchId, supabase);
  if (!profile) return null;

  return {
    name: profile.name,
    phone: profile.phone,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    zip: profile.zip,
    website: profile.website,
    slug: profile.slug,
    stripeChargesEnabled: profile.stripeChargesEnabled,
    denomination: profile.denomination,
    officeHours: profile.officeHours,
    aiKnowledge: profile.aiKnowledge,
    holidaySchedule: profile.holidaySchedule,
  };
}

export function buildDefaultGreeting(churchName: string, assistantName: string): string {
  const name = assistantName.trim() || "the church desk";
  return withRecordingDisclosure(
    `Hi, you've reached ${churchName}. This is ${name}.`,
  );
}

export async function buildVoiceAssistantFormDefaults(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<VoiceAssistantFormState> {
  const client = supabase ?? db();
  const settings = await getVoiceAssistantSettings(churchId, client);

  return {
    assistantName: settings?.assistant_name ?? "",
    emergencyPhone: settings?.emergency_phone ?? "",
    tone: settings?.tone ?? "warm_friendly",
    speakingPace: settings?.speaking_pace ?? "normal",
    voiceGender: settings?.voice_gender ?? "male",
    language: settings?.language ?? "en",
    signoffMessage: settings?.signoff_message ?? "God bless you. Have a wonderful day.",
    afterHoursEnabled: settings?.after_hours_enabled ?? false,
    afterHoursMessage: settings?.after_hours_message ?? "",
  };
}

export async function upsertVoiceAssistantSettings(
  churchId: string,
  patch: VoiceAssistantFormState,
  supabase?: SupabaseClient,
): Promise<VoiceAssistantSettings> {
  const client = supabase ?? db();
  const assistantName = patch.assistantName.trim();
  const profile = await getChurchProfileForVoice(churchId, client);
  const churchName = profile?.name?.trim() || "your church";
  const previous = await getVoiceAssistantSettings(churchId, client);
  const previousName = previous?.assistant_name?.trim() || null;

  const signoffMessage =
    replaceAssistantNameInText(
      patch.signoffMessage.trim(),
      previousName,
      assistantName,
    ) || null;

  const afterHoursMessage =
    replaceAssistantNameInText(
      patch.afterHoursMessage.trim(),
      previousName,
      assistantName,
    ) || null;

  const { data, error } = await client
    .from("voice_assistant_settings")
    .upsert(
      {
        church_id: churchId,
        assistant_name: assistantName || null,
        emergency_phone: patch.emergencyPhone.trim() || null,
        tone: patch.tone,
        speaking_pace: patch.speakingPace,
        voice_gender: patch.voiceGender,
        language: patch.language,
        signoff_message: signoffMessage,
        after_hours_enabled: patch.afterHoursEnabled,
        after_hours_message: afterHoursMessage,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return mapSettings(data);
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function formatEventLine(title: string, startAt: string, location?: string): string {
  const date = new Date(startAt);
  const when = date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const loc = location?.trim();
  return loc ? `${title} — ${when} (${loc})` : `${title} — ${when}`;
}

function uniqueLines(lines: string[]): string[] {
  return Array.from(new Set(lines.filter(Boolean)));
}

export async function getVoiceAssistantContext(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<VoiceAssistantContext> {
  const client = supabase ?? db();

  const now30 = new Date();
  const calendar = await listChurchCalendarEvents(
    churchId,
    now30.toISOString(),
    new Date(now30.getTime() + 30 * 86_400_000).toISOString(),
    client,
  ).catch(() => null);
  const calendarEvents = calendar?.events ?? [];

  const [announcements, profile] = await Promise.all([
    getPublishedAnnouncements(client, churchId),
    getChurchProfile(churchId, client),
  ]);

  const now = new Date();
  const upcomingFromAnnouncements = announcements
    .filter((a) => new Date(a.start_at) >= now)
    .slice(0, 10)
    .map((a) =>
      formatEventLine(a.title, a.start_at, a.event_location ?? undefined),
    );

  const upcomingFromCalendar = calendarEvents
    .slice(0, 10)
    .map((e) => formatEventLine(e.title, e.startAt, e.location));

  const structuredServices =
    profile?.serviceTimes.map(formatServiceTimeLine) ?? [];

  const serviceFromCalendar = calendarEvents
    .filter((e) => matchesKeywords(e.title, SERVICE_KEYWORDS))
    .map((e) => formatEventLine(e.title, e.startAt, e.location));

  const serviceFromAnnouncements = announcements
    .filter((a) => matchesKeywords(a.title, SERVICE_KEYWORDS))
    .map((a) =>
      formatEventLine(a.title, a.start_at, a.event_location ?? undefined),
    );

  const structuredPrograms = [
    profile?.aiKnowledge.kids?.trim(),
    profile?.aiKnowledge.youth?.trim(),
    profile?.aiKnowledge.volunteer?.trim(),
  ].filter(Boolean) as string[];

  const programsFromCalendar = calendarEvents
    .filter(
      (e) =>
        matchesKeywords(e.title, PROGRAM_KEYWORDS) &&
        !matchesKeywords(e.title, SERVICE_KEYWORDS),
    )
    .map((e) => e.title);

  const programsFromAnnouncements = announcements
    .filter(
      (a) =>
        matchesKeywords(a.title, PROGRAM_KEYWORDS) &&
        !matchesKeywords(a.title, SERVICE_KEYWORDS),
    )
    .map((a) => a.title);

  const publicStaff = (profile?.staff ?? [])
    .filter((member) => member.is_public)
    .sort((a, b) => {
      if (a.ai_contact_priority !== b.ai_contact_priority) {
        return b.ai_contact_priority - a.ai_contact_priority;
      }
      return a.sort_order - b.sort_order;
    })
    .map(formatStaffLine);

  const pastoralStaff =
    publicStaff.length > 0
      ? publicStaff
      : profile?.phone
        ? [`Main office — ${profile.phone}`]
        : [];

  const serviceSchedule =
    structuredServices.length > 0
      ? uniqueLines(structuredServices)
      : uniqueLines([...serviceFromCalendar, ...serviceFromAnnouncements]);

  const programs =
    structuredPrograms.length > 0
      ? uniqueLines(structuredPrograms)
      : uniqueLines([...programsFromCalendar, ...programsFromAnnouncements]);

  return {
    serviceSchedule: serviceSchedule.slice(0, 8),
    upcomingEvents: uniqueLines([
      ...upcomingFromCalendar,
      ...upcomingFromAnnouncements,
    ]).slice(0, 8),
    pastoralStaff: pastoralStaff.slice(0, 8),
    programs: programs.slice(0, 8),
  };
}

const PHONE_CALL_SELECT_LEGACY =
  "id, caller_number, duration_seconds, outcome, sentiment, transcript, called_at, ai_score, recording_url, call_successful, score_breakdown, notes, scored_at";

const PHONE_CALL_SELECT = `${PHONE_CALL_SELECT_LEGACY}, call_classification, notify_pastor, urgency`;

/** True when the database has not had migration 0070 applied yet. */
function isMissingScoringColumns(message: string): boolean {
  return /call_classification|notify_pastor|urgency/i.test(message);
}

/**
 * Fill in the 0070 columns a pre-migration database does not have.
 *
 * They are only ever a faster copy of what already sits in `score_breakdown`,
 * so a row read from an older schema is not missing information — it just has
 * to be read out of the JSON instead. Every consumer goes through
 * `describeCallScore`, which looks in both places.
 */
function withScoringDefaults(rows: unknown[]): PhoneCallRow[] {
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      ...(record as unknown as PhoneCallRow),
      call_classification:
        (record.call_classification as PhoneCallRow["call_classification"]) ??
        null,
      notify_pastor: (record.notify_pastor as boolean | null) ?? null,
      urgency: (record.urgency as PhoneCallRow["urgency"]) ?? null,
    };
  });
}

export async function getRecentPhoneCalls(
  churchId: string,
  limit = 100,
  supabase?: SupabaseClient,
): Promise<PhoneCallRow[]> {
  const client = supabase ?? db();
  const query = (columns: string) =>
    client
      .from("phone_calls")
      .select(columns)
      .eq("church_id", churchId)
      .order("called_at", { ascending: false })
      .limit(limit);

  const { data, error } = await query(PHONE_CALL_SELECT);

  if (error && isMissingScoringColumns(error.message)) {
    const legacy = await query(PHONE_CALL_SELECT_LEGACY);
    return withScoringDefaults(legacy.data ?? []);
  }

  return withScoringDefaults(data ?? []);
}

export async function getPhoneCallById(
  churchId: string,
  callId: string,
  supabase?: SupabaseClient,
): Promise<PhoneCallRow | null> {
  const client = supabase ?? db();
  const query = (columns: string) =>
    client
      .from("phone_calls")
      .select(columns)
      .eq("church_id", churchId)
      .eq("id", callId)
      .maybeSingle();

  const { data, error } = await query(PHONE_CALL_SELECT);

  if (error && isMissingScoringColumns(error.message)) {
    const legacy = await query(PHONE_CALL_SELECT_LEGACY);
    return legacy.data ? withScoringDefaults([legacy.data])[0] : null;
  }

  return data ? withScoringDefaults([data])[0] : null;
}

export async function getVoiceAgentSyncStatus(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<VoiceAgentSyncStatus> {
  const settings = await getVoiceAssistantSettings(churchId, supabase);

  return {
    agentId: settings?.retail_ai_agent_id ?? null,
    llmId: settings?.retell_llm_id ?? null,
    phoneNumber: settings?.retail_ai_phone_number ?? null,
    syncedAt: settings?.agent_synced_at ?? null,
    isConfigured: Boolean(settings?.assistant_name?.trim()),
    agentMode: settings?.agent_mode ?? "managed",
  };
}
