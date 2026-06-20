export const SOCIAL_BACKGROUND_TAGS = [
  "youth",
  "worship",
  "outreach",
  "community",
  "prayer",
  "bible-study",
  "fellowship",
  "seasonal-christmas",
  "seasonal-easter",
  "family",
  "missions",
  "default",
] as const;

export type SocialBackgroundTag = (typeof SOCIAL_BACKGROUND_TAGS)[number];

export const SOCIAL_TEMPLATE_KEYS = [
  "general",
  "youth",
  "outreach",
  "worship-night",
] as const;

export type SocialTemplateKey = (typeof SOCIAL_TEMPLATE_KEYS)[number];

export const SOCIAL_GRAPHICS_BUCKET = "social-graphics";
export const SOCIAL_BACKGROUNDS_BUCKET = "social-backgrounds";
