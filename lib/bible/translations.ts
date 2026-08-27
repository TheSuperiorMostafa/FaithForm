import {
  hasLocalTranslation,
  listLocalTranslationCodes,
} from "@/lib/bible/local-data";

export type TranslationSource = "helloao" | "esv" | "local";

export type CuratedTranslation = {
  id: string;
  label: string;
  shortName: string;
  source: TranslationSource;
  fileCode: string;
};

const CURATED: CuratedTranslation[] = [
  {
    id: "KJV",
    label: "King James Version",
    shortName: "KJV",
    source: "local",
    fileCode: "KJV",
  },
  {
    id: "ESV",
    label: "English Standard Version",
    shortName: "ESV",
    source: "esv",
    fileCode: "ESV",
  },
  {
    id: "NIV",
    label: "New International Version",
    shortName: "NIV",
    source: "local",
    fileCode: "NIV",
  },
  {
    id: "NLT",
    label: "New Living Translation",
    shortName: "NLT",
    source: "local",
    fileCode: "NLT",
  },
  {
    id: "CSB",
    label: "Christian Standard Bible",
    shortName: "CSB",
    source: "local",
    fileCode: "CSB",
  },
  {
    id: "NKJV",
    label: "New King James Version",
    shortName: "NKJV",
    source: "local",
    fileCode: "NKJV",
  },
  {
    id: "NASB",
    label: "New American Standard Bible",
    shortName: "NASB",
    source: "local",
    fileCode: "NASB",
  },
  {
    id: "NRSV",
    label: "New Revised Standard Version",
    shortName: "NRSV",
    source: "local",
    fileCode: "NRSV",
  },
];

export type CuratedTranslationOption = CuratedTranslation & {
  enabled: boolean;
};

const LEGACY_ID_MAP: Record<string, string> = {
  eng_kjv: "KJV",
  KJAV: "KJV",
};

function isEsvApiEnabled(): boolean {
  return Boolean(process.env.ESV_API_KEY);
}

export function normalizeTranslationId(id: string): string {
  return LEGACY_ID_MAP[id] ?? id;
}

export async function getCuratedTranslations(): Promise<CuratedTranslationOption[]> {
  const localCodes = await listLocalTranslationCodes();
  const esvApi = isEsvApiEnabled();

  return CURATED.map((t) => ({
    ...t,
    enabled: computeTranslationEnabled(t, localCodes, esvApi),
  }));
}

function computeTranslationEnabled(
  t: CuratedTranslation,
  localCodes: Set<string>,
  esvApi: boolean,
): boolean {
  if (localCodes.has(t.fileCode)) return true;
  if (t.id === "ESV" && esvApi) return true;
  if (t.id === "KJV") return true;
  return false;
}

export async function getDefaultTranslationId(
  churchDefault?: string | null,
): Promise<string> {
  const curated = await getCuratedTranslations();
  const normalizedDefault = churchDefault
    ? normalizeTranslationId(churchDefault)
    : null;

  if (normalizedDefault) {
    const match = curated.find((t) => t.id === normalizedDefault && t.enabled);
    if (match) return match.id;
  }

  const preferred = ["ESV", "NIV", "KJV", "NLT", "CSB", "NKJV", "NASB", "NRSV"];
  for (const id of preferred) {
    const match = curated.find((t) => t.id === id && t.enabled);
    if (match) return match.id;
  }

  return "KJV";
}

export function isCuratedTranslationId(id: string): boolean {
  const normalized = normalizeTranslationId(id);
  return CURATED.some((t) => t.id === normalized);
}

export async function usesLocalTranslationJson(id: string): Promise<boolean> {
  const normalized = normalizeTranslationId(id);
  const entry = CURATED.find((t) => t.id === normalized);
  if (!entry) return false;
  if (normalized === "ESV" && isEsvApiEnabled()) return false;
  return hasLocalTranslation(entry.fileCode);
}

export function isEsvTranslation(id: string): boolean {
  return normalizeTranslationId(id) === "ESV";
}

/** helloao translation id used for book lists (all curated translations share KJV structure). */
export function getBooksTranslationId(_translationId?: string): string {
  return "eng_kjv";
}

export function getTranslationShortName(translationId: string): string {
  const normalized = normalizeTranslationId(translationId);
  return CURATED.find((t) => t.id === normalized)?.shortName ?? translationId;
}

export function getTranslationFileCode(translationId: string): string {
  const normalized = normalizeTranslationId(translationId);
  return CURATED.find((t) => t.id === normalized)?.fileCode ?? normalized;
}
