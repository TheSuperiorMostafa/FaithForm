export type AIProvider = "anthropic" | "openai";

export type SermonBuilderMode = "simple" | "advanced";

export type SermonKind = "simple" | "advanced";

export type SermonStatus = "draft" | "published";

export type SermonAssetKind =
  | "discussion_questions"
  | "social_snippet"
  | "export_pdf"
  | "export_pptx";

export type SermonPoint = {
  title: string;
  summary: string;
  scripture?: string;
};

export type SermonOutline = {
  title: string;
  intro: string;
  points: SermonPoint[];
  application: string;
  closing: string;
};

export type SermonContent = {
  intro: string;
  points: Array<{ title: string; body: string }>;
  illustrations: string[];
  application: string;
  prayer: string;
};

export type DiscussionQuestion = {
  category: "warmup" | "observation" | "interpretation" | "application";
  question: string;
};

export type SocialSnippets = {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  email?: string;
};

export type SeriesWeek = {
  week: number;
  title: string;
  scripture: string;
  themes: string[];
};

export type SeriesPlan = {
  weeks: SeriesWeek[];
};

export type ChurchSettings = {
  church_id: string;
  ai_provider: AIProvider;
  ai_model_override: string | null;
  default_translation: string;
  preaching_style: string | null;
  denomination: string | null;
  sermon_builder_mode: SermonBuilderMode;
  attendance_follow_up_messages: string[] | null;
  created_at: string;
  updated_at: string;
};

export type Sermon = {
  id: string;
  church_id: string;
  created_by: string;
  series_id: string | null;
  title: string;
  scripture_refs: string[];
  topic: string;
  audience: string;
  duration_min: number;
  style_notes: string | null;
  status: SermonStatus;
  kind: SermonKind;
  theme_id: string | null;
  translation: string | null;
  sermon_date: string | null;
  content: SermonContent | null;
  outline: SermonOutline | null;
  model_used: string | null;
  created_at: string;
  updated_at: string;
  outline_generated_at?: string | null;
  content_generated_at?: string | null;
  published_at?: string | null;
};

export type SermonSeries = {
  id: string;
  church_id: string;
  title: string;
  theme: string;
  description: string | null;
  weeks_planned: number;
  plan: SeriesPlan | null;
  created_at: string;
  updated_at: string;
};

export type SermonContext = {
  topic: string;
  scripture_refs: string[];
  audience: string;
  duration_min: number;
  style_notes?: string | null;
  denomination?: string | null;
  preaching_style?: string | null;
};
