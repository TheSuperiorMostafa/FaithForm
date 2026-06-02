import type { SlideVerse } from "@/lib/bible/render";

export type TitleSlide = {
  id: string;
  kind: "title";
  title: string;
  subtitle?: string;
};

export type ScriptureSlide = {
  id: string;
  kind: "scripture";
  reference: string;
  translationShort: string;
  verses: SlideVerse[];
};

export type NotesSlide = {
  id: string;
  kind: "notes";
  title?: string;
  body: string;
};

export type Slide = TitleSlide | ScriptureSlide | NotesSlide;

export type SermonState = {
  title: string;
  subtitle?: string;
  translationId: string;
  slides: Slide[];
};

export const SERMON_STORAGE_KEY = "faithform:sermon-draft";

export const DEFAULT_SERMON_STATE: SermonState = {
  title: "Untitled Sermon",
  translationId: "BSB",
  slides: [
    {
      id: "title-1",
      kind: "title",
      title: "Untitled Sermon",
    },
  ],
};

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
