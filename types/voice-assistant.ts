export const VOICE_TONES = [
  "warm_friendly",
  "professional",
  "traditional_formal",
] as const;

export type VoiceTone = (typeof VOICE_TONES)[number];

export const SPEAKING_PACES = ["slow", "normal", "energetic"] as const;

export type SpeakingPace = (typeof SPEAKING_PACES)[number];

export const DENOMINATIONS = [
  "Baptist",
  "Catholic",
  "Methodist",
  "Presbyterian",
  "Non-Denominational",
  "Pentecostal",
  "Lutheran",
  "Anglican",
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
  created_at: string;
  updated_at: string;
};

export type VoiceAssistantContext = {
  serviceSchedule: string[];
  upcomingEvents: string[];
  pastoralStaff: string[];
  programs: string[];
};

export type PhoneCallRow = {
  id: string;
  caller_number: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  called_at: string;
};

export type VoiceAssistantFormState = {
  assistantName: string;
  denomination: string;
  churchPhone: string;
  emergencyPhone: string;
  tone: VoiceTone;
  speakingPace: SpeakingPace;
  language: string;
  greetingMessage: string;
  signoffMessage: string;
  officeHours: OfficeHours;
  afterHoursEnabled: boolean;
  afterHoursMessage: string;
};
