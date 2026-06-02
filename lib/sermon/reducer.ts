import type { SlideVerse } from "@/lib/bible/render";
import {
  createId,
  DEFAULT_SERMON_STATE,
  type ScriptureSlide,
  type SermonState,
  type Slide,
} from "./types";

export type SermonAction =
  | { type: "HYDRATE"; state: SermonState }
  | { type: "SET_TITLE"; title: string }
  | { type: "SET_SUBTITLE"; subtitle: string }
  | { type: "SET_TRANSLATION"; translationId: string }
  | {
      type: "ADD_SCRIPTURE_SLIDES";
      reference: string;
      translationShort: string;
      verseGroups: SlideVerse[][];
    }
  | { type: "ADD_TITLE_SLIDE" }
  | { type: "ADD_NOTES_SLIDE" }
  | { type: "UPDATE_SLIDE"; id: string; patch: Partial<Slide> }
  | { type: "DELETE_SLIDE"; id: string }
  | { type: "DUPLICATE_SLIDE"; id: string }
  | { type: "MOVE_SLIDE"; id: string; direction: "up" | "down" };

export function sermonReducer(
  state: SermonState,
  action: SermonAction,
): SermonState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;

    case "SET_TITLE":
      return {
        ...state,
        title: action.title,
        slides: state.slides.map((s) =>
          s.kind === "title" ? { ...s, title: action.title } : s,
        ),
      };

    case "SET_SUBTITLE":
      return { ...state, subtitle: action.subtitle };

    case "SET_TRANSLATION":
      return { ...state, translationId: action.translationId };

    case "ADD_SCRIPTURE_SLIDES": {
      const newSlides: ScriptureSlide[] = action.verseGroups.map((verses) => ({
        id: createId("scripture"),
        kind: "scripture",
        reference: action.reference,
        translationShort: action.translationShort,
        verses,
      }));
      return { ...state, slides: [...state.slides, ...newSlides] };
    }

    case "ADD_TITLE_SLIDE":
      return {
        ...state,
        slides: [
          ...state.slides,
          {
            id: createId("title"),
            kind: "title",
            title: state.title,
            subtitle: state.subtitle,
          },
        ],
      };

    case "ADD_NOTES_SLIDE":
      return {
        ...state,
        slides: [
          ...state.slides,
          { id: createId("notes"), kind: "notes", title: "Notes", body: "" },
        ],
      };

    case "UPDATE_SLIDE":
      return {
        ...state,
        slides: state.slides.map((s) =>
          s.id === action.id ? ({ ...s, ...action.patch } as Slide) : s,
        ),
      };

    case "DELETE_SLIDE":
      if (state.slides.length <= 1) return state;
      return {
        ...state,
        slides: state.slides.filter((s) => s.id !== action.id),
      };

    case "DUPLICATE_SLIDE": {
      const index = state.slides.findIndex((s) => s.id === action.id);
      if (index === -1) return state;
      const copy = {
        ...state.slides[index],
        id: createId(state.slides[index].kind),
      };
      const slides = [...state.slides];
      slides.splice(index + 1, 0, copy);
      return { ...state, slides };
    }

    case "MOVE_SLIDE": {
      const index = state.slides.findIndex((s) => s.id === action.id);
      if (index === -1) return state;
      const target =
        action.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.slides.length) return state;
      const slides = [...state.slides];
      [slides[index], slides[target]] = [slides[target], slides[index]];
      return { ...state, slides };
    }

    default:
      return state;
  }
}

export function loadSermonFromStorage(): SermonState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("faithform:sermon-draft");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SermonState;
    if (!parsed.slides?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSermonToStorage(state: SermonState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("faithform:sermon-draft", JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export { DEFAULT_SERMON_STATE };
