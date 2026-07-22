import type { DayKey, OfficeHours } from "@/types/voice-assistant";

export const SERVICE_TIME_KINDS = ["regular", "midweek", "other"] as const;
export type ServiceTimeKind = (typeof SERVICE_TIME_KINDS)[number];

export const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type AiKnowledgeKey =
  | "summary"
  | "history"
  | "culture"
  | "beliefs"
  | "faq"
  | "visitor"
  | "parking"
  | "kids"
  | "youth"
  | "accessibility"
  | "languages"
  | "dress"
  | "communion"
  | "baptism"
  | "membership"
  | "volunteer"
  | "giving_info"
  | "emergency_instructions"
  | "personality_notes"
  | "greeting"
  | "escalation_rules"
  | "restricted_topics"
  | "additional_context";

export type AiKnowledge = Partial<Record<AiKnowledgeKey, string>>;

export type ChurchServiceTime = {
  id: string;
  church_id: string;
  label: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  kind: ServiceTimeKind;
  notes: string | null;
  sort_order: number;
};

export type ChurchStaffMember = {
  id: string;
  church_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  bio: string | null;
  is_senior_pastor: boolean;
  is_executive_pastor: boolean;
  ai_contact_priority: number;
  sort_order: number;
  is_public: boolean;
};

export type ChurchProfile = {
  churchId: string;
  name: string;
  tagline: string | null;
  missionStatement: string | null;
  visionStatement: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  timezone: string;
  denomination: string | null;
  officeHours: OfficeHours;
  holidaySchedule: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
  podcastUrl: string | null;
  livestreamUrl: string | null;
  announcementFacebookPostTime: string;
  slug: string | null;
  stripeChargesEnabled: boolean;
  aiKnowledge: AiKnowledge;
  serviceTimes: ChurchServiceTime[];
  staff: ChurchStaffMember[];
};

export type ChurchProfileFormState = {
  name: string;
  tagline: string;
  missionStatement: string;
  visionStatement: string;
  description: string;
  logoUrl: string;
  coverImageUrl: string;
  primaryColor: string;
  accentColor: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  googleMapsUrl: string;
  timezone: string;
  denomination: string;
  officeHours: OfficeHours;
  holidaySchedule: string;
  facebookUrl: string;
  instagramUrl: string;
  youtubeUrl: string;
  tiktokUrl: string;
  xUrl: string;
  podcastUrl: string;
  livestreamUrl: string;
  announcementFacebookPostTime: string;
  aiKnowledge: AiKnowledge;
  serviceTimes: ServiceTimeFormRow[];
  staff: StaffFormRow[];
};

export type ServiceTimeFormRow = {
  clientId: string;
  id?: string;
  label: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  kind: ServiceTimeKind;
  notes: string;
};

export type StaffFormRow = {
  clientId: string;
  id?: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
  photoUrl: string;
  bio: string;
  isSeniorPastor: boolean;
  isExecutivePastor: boolean;
  aiContactPriority: number;
  isPublic: boolean;
};

export const AI_KNOWLEDGE_FIELDS: {
  key: AiKnowledgeKey;
  label: string;
  description: string;
  rows?: number;
}[] = [
  {
    key: "summary",
    label: "Church summary",
    description: "A short overview your AI can share with callers and sermon tools.",
    rows: 3,
  },
  {
    key: "greeting",
    label: "Phone greeting",
    description: "First thing callers hear after the recording notice. The recording disclosure is spoken first automatically.",
    rows: 3,
  },
  {
    key: "history",
    label: "History",
    description: "When the church was founded and key milestones.",
    rows: 3,
  },
  {
    key: "culture",
    label: "Culture & values",
    description: "What worship and community feel like here.",
    rows: 3,
  },
  {
    key: "beliefs",
    label: "Beliefs",
    description: "Core doctrinal or theological summary (keep it factual, not argumentative).",
    rows: 4,
  },
  {
    key: "visitor",
    label: "First-time visitors",
    description: "What to expect, where to go, and how to feel welcome.",
    rows: 3,
  },
  {
    key: "parking",
    label: "Parking & directions",
    description: "Where to park, which entrance to use, accessibility notes.",
    rows: 3,
  },
  {
    key: "kids",
    label: "Kids ministry",
    description: "Children's programs, ages, check-in, and safety.",
    rows: 3,
  },
  {
    key: "youth",
    label: "Youth ministry",
    description: "Student programs and meeting times.",
    rows: 3,
  },
  {
    key: "accessibility",
    label: "Accessibility",
    description: "Wheelchair access, hearing assistance, etc.",
    rows: 2,
  },
  {
    key: "languages",
    label: "Languages",
    description: "Translation or multilingual services if offered.",
    rows: 2,
  },
  {
    key: "dress",
    label: "Dress code",
    description: "What people typically wear on Sunday.",
    rows: 2,
  },
  {
    key: "communion",
    label: "Communion",
    description: "Who may participate and how often it is served.",
    rows: 2,
  },
  {
    key: "baptism",
    label: "Baptism",
    description: "How someone can be baptized at your church.",
    rows: 2,
  },
  {
    key: "membership",
    label: "Membership",
    description: "Path to membership or joining the church.",
    rows: 2,
  },
  {
    key: "volunteer",
    label: "Volunteering",
    description: "How to serve and get involved.",
    rows: 2,
  },
  {
    key: "giving_info",
    label: "Giving info",
    description: "Ways to give beyond the online page (envelopes, apps, etc.).",
    rows: 2,
  },
  {
    key: "faq",
    label: "FAQ",
    description: "Common questions and short answers.",
    rows: 4,
  },
  {
    key: "emergency_instructions",
    label: "Emergency instructions",
    description: "What the assistant should say or do in urgent situations.",
    rows: 3,
  },
  {
    key: "personality_notes",
    label: "AI personality notes",
    description: "Extra guidance for how the voice assistant should sound.",
    rows: 2,
  },
  {
    key: "escalation_rules",
    label: "Escalation rules",
    description: "When to transfer to staff vs. take a message.",
    rows: 3,
  },
  {
    key: "restricted_topics",
    label: "Restricted topics",
    description: "Topics the assistant should not discuss.",
    rows: 2,
  },
  {
    key: "additional_context",
    label: "Additional context",
    description: "Anything else AI tools should know.",
    rows: 3,
  },
];

export function newServiceTimeRow(): ServiceTimeFormRow {
  return {
    clientId: crypto.randomUUID(),
    label: "Sunday Worship",
    dayOfWeek: 0,
    startTime: "10:00",
    endTime: "11:30",
    kind: "regular",
    notes: "",
  };
}

export function newStaffRow(): StaffFormRow {
  return {
    clientId: crypto.randomUUID(),
    fullName: "",
    title: "",
    email: "",
    phone: "",
    photoUrl: "",
    bio: "",
    isSeniorPastor: false,
    isExecutivePastor: false,
    aiContactPriority: 0,
    isPublic: true,
  };
}

export function emptyAiKnowledge(): AiKnowledge {
  return {};
}
