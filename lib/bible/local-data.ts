import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CURATED_TRANSLATION_FILE_CODES } from "@/lib/bible/curated-codes";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

/** Book → Chapter → Verse → text */
export type LocalBibleJson = Record<
  string,
  Record<string, Record<string, string>>
>;

const BUCKET = "bible-text";
const CACHE_TTL_MS = 30 * 60 * 1000;

const jsonCache = new Map<string, { data: LocalBibleJson; expiresAt: number }>();
let catalogCache: { codes: Set<string>; expiresAt: number } | null = null;

function localDevPath(code: string): string {
  return path.join(process.cwd(), "data", "bible", `${code}.json`);
}

async function loadFromFilesystem(code: string): Promise<LocalBibleJson | null> {
  const filePath = localDevPath(code);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as LocalBibleJson;
}

async function loadFromStorage(code: string): Promise<LocalBibleJson | null> {
  const admin = createAdminClientOrNull();
  if (!admin) return null;

  const storagePath = `${code}.json`;
  const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
  if (error || !data) return null;

  const text = await data.text();
  return JSON.parse(text) as LocalBibleJson;
}

export async function loadLocalTranslationJson(
  code: string,
): Promise<LocalBibleJson | null> {
  const cached = jsonCache.get(code);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const fromDisk = await loadFromFilesystem(code);
  const data = fromDisk ?? (await loadFromStorage(code));
  if (!data) return null;

  jsonCache.set(code, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function listLocalTranslationCodes(): Promise<Set<string>> {
  if (catalogCache && Date.now() < catalogCache.expiresAt) {
    return catalogCache.codes;
  }

  const codes = new Set<string>();

  for (const code of CURATED_TRANSLATION_FILE_CODES) {
    if (existsSync(localDevPath(code))) {
      codes.add(code);
    }
  }

  const admin = createAdminClientOrNull();
  if (admin) {
    const { data: rows } = await admin
      .from("bible_text_translations")
      .select("code")
      .eq("active", true);

    for (const row of rows ?? []) {
      codes.add(row.code as string);
    }

    if (codes.size === 0) {
      const { data: files } = await admin.storage.from(BUCKET).list("", {
        limit: 100,
      });
      for (const file of files ?? []) {
        if (file.name?.endsWith(".json")) {
          codes.add(file.name.replace(/\.json$/, ""));
        }
      }
    }
  }

  catalogCache = { codes, expiresAt: Date.now() + CACHE_TTL_MS };
  return codes;
}

export function invalidateLocalBibleCache(): void {
  jsonCache.clear();
  catalogCache = null;
}

export async function hasLocalTranslation(code: string): Promise<boolean> {
  const codes = await listLocalTranslationCodes();
  return codes.has(code);
}
