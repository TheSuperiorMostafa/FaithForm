import type { SupabaseClient } from "@supabase/supabase-js";
import { listUpcomingCalendarEvents } from "@/lib/integrations/google-calendar";
import { getPublishedAnnouncements } from "@/lib/queries/announcements";
import { getChurchAISettings } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";
import type {
  DayKey,
  OfficeHours,
  PhoneCallRow,
  SpeakingPace,
  VoiceAssistantContext,
  VoiceAssistantFormState,
  VoiceAgentSyncStatus,
  VoiceAssistantSettings,
  VoiceTone,
} from "@/types/voice-assistant";

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

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

export function defaultOfficeHours(): OfficeHours {
  const weekday = { enabled: true, open: "09:00", close: "17:00" };
  const weekend = { enabled: false, open: "09:00", close: "17:00" };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...weekend },
    sun: { ...weekend },
  };
}

function normalizeOfficeHours(raw: unknown): OfficeHours {
  const defaults = defaultOfficeHours();
  if (!raw || typeof raw !== "object") return defaults;

  const record = raw as Record<string, Partial<{ enabled: boolean; open: string; close: string }>>;
  const result = { ...defaults };

  for (const key of DAY_KEYS) {
    const day = record[key];
    if (day && typeof day === "object") {
      result[key] = {
        enabled: Boolean(day.enabled),
        open: typeof day.open === "string" ? day.open : defaults[key].open,
        close: typeof day.close === "string" ? day.close : defaults[key].close,
      };
    }
  }

  return result;
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
};

export async function getChurchProfileForVoice(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<ChurchProfileForVoice | null> {
  const client = supabase ?? db();
  const { data } = await client
    .from("churches")
    .select(
      "name, phone, address, city, state, zip, website, slug, stripe_charges_enabled",
    )
    .eq("id", churchId)
    .maybeSingle();

  if (!data) return null;
  return {
    name: data.name as string,
    phone: (data.phone as string | null) ?? null,
    address: (data.address as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    state: (data.state as string | null) ?? null,
    zip: (data.zip as string | null) ?? null,
    website: (data.website as string | null) ?? null,
    slug: (data.slug as string | null) ?? null,
    stripeChargesEnabled: Boolean(data.stripe_charges_enabled),
  };
}

export function buildDefaultGreeting(churchName: string, assistantName: string): string {
  const name = assistantName.trim() || "[Assistant Name]";
  return `Thank you for calling ${churchName}. This is ${name}, how can I help you today?`;
}

export async function buildVoiceAssistantFormDefaults(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<VoiceAssistantFormState> {
  const client = supabase ?? db();
  const [settings, profile, aiSettings] = await Promise.all([
    getVoiceAssistantSettings(churchId, client),
    getChurchProfileForVoice(churchId, client),
    getChurchAISettings(churchId),
  ]);

  const churchName = profile?.name ?? "your church";
  const assistantName = settings?.assistant_name ?? "";

  return {
    assistantName,
    denomination: settings?.denomination ?? aiSettings?.denomination ?? "",
    churchPhone: settings?.church_phone ?? profile?.phone ?? "",
    emergencyPhone: settings?.emergency_phone ?? "",
    tone: settings?.tone ?? "warm_friendly",
    speakingPace: settings?.speaking_pace ?? "normal",
    language: settings?.language ?? "en",
    greetingMessage:
      settings?.greeting_message ?? buildDefaultGreeting(churchName, assistantName),
    signoffMessage: settings?.signoff_message ?? "God bless you. Have a wonderful day.",
    officeHours: settings?.office_hours ?? defaultOfficeHours(),
    afterHoursEnabled: settings?.after_hours_enabled ?? false,
    afterHoursMessage: settings?.after_hours_message ?? "",
  };
}

export async function upsertVoiceAssistantSettings(
  churchId: string,
  patch: Omit<
    VoiceAssistantFormState,
    never
  >,
  supabase?: SupabaseClient,
): Promise<VoiceAssistantSettings> {
  const client = supabase ?? db();
  const { data, error } = await client
    .from("voice_assistant_settings")
    .upsert(
      {
        church_id: churchId,
        assistant_name: patch.assistantName.trim() || null,
        denomination: patch.denomination.trim() || null,
        church_phone: patch.churchPhone.trim() || null,
        emergency_phone: patch.emergencyPhone.trim() || null,
        tone: patch.tone,
        speaking_pace: patch.speakingPace,
        language: patch.language,
        greeting_message: patch.greetingMessage.trim() || null,
        signoff_message: patch.signoffMessage.trim() || null,
        office_hours: patch.officeHours,
        after_hours_enabled: patch.afterHoursEnabled,
        after_hours_message: patch.afterHoursMessage.trim() || null,
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

  let calendarEvents: Awaited<ReturnType<typeof listUpcomingCalendarEvents>> = [];
  try {
    calendarEvents = await listUpcomingCalendarEvents(churchId, 30, client);
  } catch {
    calendarEvents = [];
  }

  const [announcements, profile, adminUsers] = await Promise.all([
    getPublishedAnnouncements(client, churchId),
    getChurchProfileForVoice(churchId, client),
    client
      .from("church_users")
      .select("role, user_id")
      .eq("church_id", churchId)
      .eq("role", "admin"),
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

  const serviceFromCalendar = calendarEvents
    .filter((e) => matchesKeywords(e.title, SERVICE_KEYWORDS))
    .map((e) => formatEventLine(e.title, e.startAt, e.location));

  const serviceFromAnnouncements = announcements
    .filter((a) => matchesKeywords(a.title, SERVICE_KEYWORDS))
    .map((a) =>
      formatEventLine(a.title, a.start_at, a.event_location ?? undefined),
    );

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

  const pastoralStaff: string[] = [];
  if (profile?.phone) {
    pastoralStaff.push(`Main office — ${profile.phone}`);
  }
  const adminCount = adminUsers.data?.length ?? 0;
  if (adminCount > 0) {
    pastoralStaff.push(
      `${adminCount} church ${adminCount === 1 ? "leader" : "leaders"} on staff`,
    );
  }

  return {
    serviceSchedule: uniqueLines([...serviceFromCalendar, ...serviceFromAnnouncements]).slice(
      0,
      8,
    ),
    upcomingEvents: uniqueLines([
      ...upcomingFromCalendar,
      ...upcomingFromAnnouncements,
    ]).slice(0, 8),
    pastoralStaff,
    programs: uniqueLines([
      ...programsFromCalendar,
      ...programsFromAnnouncements,
    ]).slice(0, 8),
  };
}

export async function getRecentPhoneCalls(
  churchId: string,
  limit = 25,
  supabase?: SupabaseClient,
): Promise<PhoneCallRow[]> {
  const client = supabase ?? db();
  const { data } = await client
    .from("phone_calls")
    .select(
      "id, caller_number, duration_seconds, outcome, sentiment, transcript, called_at",
    )
    .eq("church_id", churchId)
    .order("called_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as PhoneCallRow[];
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
  };
}
