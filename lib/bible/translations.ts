export type TranslationSource = "helloao" | "esv" | "pending";

export type CuratedTranslation = {
  id: string;
  label: string;
  shortName: string;
  source: TranslationSource;
};

const CURATED: CuratedTranslation[] = [
  { id: "eng_kjv", label: "King James Version", shortName: "KJV", source: "helloao" },
  { id: "ESV", label: "English Standard Version", shortName: "ESV", source: "esv" },
  { id: "NIV", label: "New International Version", shortName: "NIV", source: "pending" },
  { id: "NLT", label: "New Living Translation", shortName: "NLT", source: "pending" },
  { id: "CSB", label: "Christian Standard Bible", shortName: "CSB", source: "pending" },
  { id: "NKJV", label: "New King James Version", shortName: "NKJV", source: "pending" },
];

export type CuratedTranslationOption = CuratedTranslation & {
  enabled: boolean;
};

function isEsvEnabled(): boolean {
  return Boolean(process.env.ESV_API_KEY);
}

export function getCuratedTranslations(): CuratedTranslationOption[] {
  return CURATED.map((t) => ({
    ...t,
    enabled:
      t.source === "helloao" ||
      (t.source === "esv" && isEsvEnabled()),
  }));
}

export function getDefaultTranslationId(
  churchDefault?: string | null,
): string {
  const curated = getCuratedTranslations();
  if (churchDefault === "ESV") {
    const esv = curated.find((t) => t.id === "ESV" && t.enabled);
    if (esv) return esv.id;
  }
  const firstEnabled = curated.find((t) => t.enabled);
  return firstEnabled?.id ?? "eng_kjv";
}

export function isCuratedTranslationId(id: string): boolean {
  return CURATED.some((t) => t.id === id);
}

export function isEsvTranslation(id: string): boolean {
  return id === "ESV";
}

/** helloao translation id used for book lists (ESV shares KJV book ids). */
export function getBooksTranslationId(translationId: string): string {
  if (isEsvTranslation(translationId)) return "eng_kjv";
  return translationId;
}

export function getTranslationShortName(translationId: string): string {
  return CURATED.find((t) => t.id === translationId)?.shortName ?? translationId;
}
