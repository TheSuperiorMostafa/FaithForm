import type {
  CallClassification,
  CallerMood,
  CallLabel,
  CallUrgency,
} from "@/lib/integrations/phone-call-scoring-prompt";

export const VOICE_TONES = [
  "warm_friendly",
  "professional",
  "traditional_formal",
] as const;

export type VoiceTone = (typeof VOICE_TONES)[number];

export const SPEAKING_PACES = ["slow", "normal", "energetic"] as const;

export type SpeakingPace = (typeof SPEAKING_PACES)[number];

export const VOICE_GENDERS = ["male", "female"] as const;

export type VoiceGender = (typeof VOICE_GENDERS)[number];

/**
 * 'managed' — FaithForm creates the Retell agent and pushes prompt/config
 * updates on every save (the default, and everything before this field
 * existed).
 * 'linked' — the agent was hand-built directly in Retell, before FaithForm
 * existed, or otherwise lives outside FaithForm's control. Call logs,
 * transcripts and scoring still flow in, but FaithForm never writes to the
 * agent or its LLM.
 */
export const AGENT_MODES = ["managed", "linked"] as const;

export type AgentMode = (typeof AGENT_MODES)[number];

export const DENOMINATIONS = [
  "Baptist",
  "Catholic",
  "Methodist",
  "Presbyterian",
  "Non-Denominational",
  "Pentecostal",
  "Lutheran",
  "Anglican",
  "Nazarene",
  "Other",
] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

export const VOICE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Chinese (Mandarin)" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "de", label: "German" },
  { code: "ko", label: "Korean" },
] as const;

export type DayKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export type DayHours = {
  enabled: boolean;
  open: string;
  close: string;
};

export type OfficeHours = Record<DayKey, DayHours>;

export type VoiceAssistantSettings = {
  church_id: string;
  assistant_name: string | null;
  denomination: string | null;
  church_phone: string | null;
  emergency_phone: string | null;
  tone: VoiceTone;
  speaking_pace: SpeakingPace;
  voice_gender: VoiceGender;
  language: string;
  greeting_message: string | null;
  signoff_message: string | null;
  office_hours: OfficeHours;
  after_hours_enabled: boolean;
  after_hours_message: string | null;
  retell_llm_id: string | null;
  retail_ai_agent_id: string | null;
  retail_ai_phone_number: string | null;
  agent_synced_at: string | null;
  agent_mode: AgentMode;
  created_at: string;
  updated_at: string;
};

export type VoiceAssistantContext = {
  serviceSchedule: string[];
  upcomingEvents: string[];
  pastoralStaff: string[];
  programs: string[];
};

/**
 * What the scoring model returns, plus the `version` stamp that says which
 * rubric produced it. Version 1 rows (migration 0036) carry only `score` and
 * `rationale`; everything else is optional so the two can share one type
 * without the UI having to branch on which era a call belongs to.
 */
export type PhoneCallScoreBreakdown = {
  version?: number;
  score: number;
  /** Version 1 only — replaced by `summary` and `flag_reason`. */
  rationale?: string;
  call_type?: CallClassification;
  label?: CallLabel;
  summary?: string;
  caller_mood?: CallerMood;
  flag_reason?: string | null;
  notify_pastor?: boolean;
  urgency?: CallUrgency;
  missing_knowledge?: string | null;
  [key: string]: unknown;
};

export type PhoneCallRow = {
  id: string;
  caller_number: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  sentiment: string | null;
  transcript: string | null;
  called_at: string;
  ai_score: number | null;
  recording_url: string | null;
  call_successful: boolean | null;
  score_breakdown: PhoneCallScoreBreakdown | null;
  notes: string | null;
  scored_at: string | null;
  /** Lifted out of the breakdown so the log can filter and sort on them. */
  call_classification: CallClassification | null;
  notify_pastor: boolean | null;
  urgency: CallUrgency | null;
};

export type VoiceAgentSyncStatus = {
  agentId: string | null;
  llmId: string | null;
  phoneNumber: string | null;
  syncedAt: string | null;
  isConfigured: boolean;
  agentMode: AgentMode;
};

export type VoiceAssistantFormState = {
  assistantName: string;
  emergencyPhone: string;
  tone: VoiceTone;
  speakingPace: SpeakingPace;
  voiceGender: VoiceGender;
  language: string;
  signoffMessage: string;
  afterHoursEnabled: boolean;
  afterHoursMessage: string;
};

export type VoiceProfileSummary = {
  denomination: string;
  churchPhone: string;
  greetingMessage: string;
  hasOpenOfficeDay: boolean;
};
