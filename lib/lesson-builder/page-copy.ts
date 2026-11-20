/**
 * Static page text for the Lessons area, shared by each page and its
 * `loading.tsx` so a skeleton shows the same real words (static-first rule).
 */
export const LESSONS_TITLE = "Lessons";
export const LESSONS_DESCRIPTION =
  "Teaching outlines and discussion questions for small groups and classes";

export const NEW_LESSON_TITLE = "New lesson";
export const NEW_LESSON_DESCRIPTION =
  "Build a lesson from a past sermon, or start a new one from Bible passages. We'll write an outline and discussion questions you can print or download.";

/** The two ways to start a lesson, shown as two big choices. */
export const LESSON_START_QUESTION = "How do you want to start?";
export const LESSON_START_OPTIONS = [
  {
    value: "sermon",
    title: "From a past sermon",
    description:
      "Choose a sermon by its title. The lesson uses only what was preached, and the Bible passages come from the sermon.",
  },
  {
    value: "scripture",
    title: "New lesson",
    description: "Choose the Bible passages, and we'll write a lesson from Scripture.",
  },
] as const;
export type LessonStart = (typeof LESSON_START_OPTIONS)[number]["value"];

export const LESSON_BACK_LABEL = "Back to Lessons";

export const LESSON_MAKING_LABEL = "Making your lesson…";
export const LESSON_MAKING_HINT = "This usually takes 15 to 30 seconds.";
export const LESSON_FROM_SERMON_HINT =
  "We're reading the sermon and writing the lesson. This can take up to a minute.";
