import { z } from "zod";

export const sermonPointSchema = z.object({
  title: z.string(),
  summary: z.string(),
  scripture: z.string().optional(),
});

export const sermonOutlineSchema = z.object({
  title: z.string(),
  intro: z.string(),
  points: z.array(sermonPointSchema).min(3).max(5),
  application: z.string(),
  closing: z.string(),
});

export const discussionQuestionSchema = z.object({
  category: z.enum(["warmup", "observation", "interpretation", "application"]),
  question: z.string(),
});

export const discussionQuestionsSchema = z.object({
  questions: z.array(discussionQuestionSchema).min(6).max(8),
});

/**
 * Outline and discussion questions in one generation. The lesson flow used to
 * make two sequential model calls; one round trip roughly halves the wait.
 */
export const lessonBundleSchema = z.object({
  outline: sermonOutlineSchema,
  questions: z.array(discussionQuestionSchema).min(6).max(8),
});

export const socialSnippetsSchema = z.object({
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  twitter: z.string().optional(),
  email: z.string().optional(),
});

export const socialBackgroundTagSchema = z.enum([
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
]);

export const socialTemplateKeySchema = z.enum([
  "general",
  "youth",
  "outreach",
  "worship-night",
]);

export const eventSocialPreviewSchema = z.object({
  headline: z.string().min(3).max(60),
  facebookCaption: z.string().min(10).max(400),
  backgroundTag: socialBackgroundTagSchema,
  templateKey: socialTemplateKeySchema,
  /**
   * The photograph this specific event should be illustrated with, in the
   * writer's own words.
   *
   * `backgroundTag` sorts an event into one of twelve buckets, and a bucket is
   * all the image model used to get. Every "fellowship" event — a summer
   * cookout, a newcomers' lunch, a games night — therefore came back as the
   * same stock scene. This is the per-event escape hatch: whatever is actually
   * happening, described concretely enough to photograph.
   */
  imageSubject: z.string().min(10).max(240),
  tone: z.string().optional(),
});

export const seriesWeekSchema = z.object({
  week: z.number().int().positive(),
  title: z.string(),
  scripture: z.string(),
  themes: z.array(z.string()).length(3),
});

export const seriesPlanSchema = z.object({
  weeks: z.array(seriesWeekSchema).min(2).max(12),
});

export const themeSuggestSchema = z.object({
  suggestions: z.array(z.string()).length(6),
});

export const sermonContentSchema = z.object({
  intro: z.string(),
  points: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
    }),
  ),
  illustrations: z.array(z.string()),
  application: z.string(),
  prayer: z.string(),
});
