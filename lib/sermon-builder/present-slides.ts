import { normalizeTranslationId } from "@/lib/bible/translations";
import { getThemeAsync } from "@/lib/queries/slide-themes";
import { resolveNumberedPassage } from "@/lib/sermon/passages";
import { fetchPassages } from "@/lib/scripture/esv";
import {
  derivePresentationManifest,
  snapshotTheme,
  type PresentationPage,
  type PresentationThemeSnapshot,
  type SimplePassageInput,
} from "@/lib/sermons/v1/presentation-manifest";
import type { Sermon } from "@/types/sermon";

/**
 * The slides the in-browser Present mode shows.
 *
 * Built from the same page model the app publishes and the PowerPoint export
 * draws (`derivePresentationManifest`): a title slide, then each passage split
 * into verse chunks exactly as `renderSimplePptx` splits them, then (for a full
 * sermon) its points, application and closing. The theme is the deck's own,
 * snapshotted the way publishing snapshots it. Server only.
 */
export type PresentSlides = {
  pages: PresentationPage[];
  theme: PresentationThemeSnapshot | null;
  /** References we could not look up, so the page can say which. */
  missing: string[];
};

export async function buildPresentSlides(sermon: Sermon): Promise<PresentSlides> {
  const isSimple = (sermon.kind ?? "advanced") === "simple";
  const refs = (sermon.scripture_refs ?? []).map((r) => r.trim()).filter(Boolean);
  const missing: string[] = [];

  let pages: PresentationPage[];
  if (isSimple) {
    const translation = normalizeTranslationId(sermon.translation ?? "KJV") ?? "KJV";
    const passages: SimplePassageInput[] = [];
    let translationLabel = translation;
    const resolved = await Promise.all(
      refs.map((ref) => resolveNumberedPassage(ref, translation)),
    );
    resolved.forEach((result, index) => {
      if (!result.ok) {
        missing.push(refs[index]!);
        return;
      }
      translationLabel = result.passage.translation;
      passages.push({
        verses: result.passage.verses,
        bookName: result.passage.bookName,
        chapter: result.passage.chapter,
      });
    });
    pages = derivePresentationManifest(sermon, {
      simplePassages: passages,
      translation: translationLabel,
    }).pages;
  } else {
    const found = refs.length > 0 ? await fetchPassages(refs).catch(() => []) : [];
    pages = derivePresentationManifest(sermon, {
      advancedPassages: found.map((p) => ({
        ref: p.ref,
        text: p.text,
        translation: p.translation,
      })),
    }).pages;
  }

  const themeId = sermon.theme_id ?? (isSimple ? "midnight" : null);
  let theme: PresentationThemeSnapshot | null = null;
  if (themeId) {
    try {
      theme = snapshotTheme(await getThemeAsync(themeId));
    } catch {
      theme = null;
    }
  }

  return { pages, theme, missing };
}
