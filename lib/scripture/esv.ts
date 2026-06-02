type PassageResult = {
  ref: string;
  text: string;
  copyright: string;
  translation: string;
};

const cache = new Map<string, PassageResult>();
const MAX_CACHE = 200;

function cacheSet(key: string, value: PassageResult) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, value);
}

async function fetchFromBibleApi(ref: string): Promise<PassageResult> {
  // Free, no-auth public API. Default translation is World English Bible (WEB).
  const url = `https://bible-api.com/${encodeURIComponent(ref)}?translation=web`;
  const res = await fetch(url, { next: { revalidate: 86400 } });

  if (!res.ok) {
    throw new Error(`Scripture lookup failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    reference: string;
    text: string;
    translation_name?: string;
    error?: string;
  };

  if (data.error) {
    throw new Error(data.error);
  }

  return {
    ref: data.reference ?? ref,
    text: (data.text ?? "").trim(),
    copyright:
      "World English Bible (WEB) — public domain. Source: bible-api.com",
    translation: data.translation_name ?? "WEB",
  };
}

async function fetchFromEsv(ref: string, apiKey: string): Promise<PassageResult> {
  const params = new URLSearchParams({
    q: ref,
    "include-passage-references": "false",
    "include-headings": "false",
    "include-footnotes": "false",
    "include-verse-numbers": "true",
    "include-short-copyright": "true",
    "include-passage-horizontal-lines": "false",
    "horizontal-line-length": "0",
    "include-heading-horizontal-lines": "false",
    "heading-horizontal-line-length": "0",
  });

  const res = await fetch(
    `https://api.esv.org/v3/passage/text/?${params.toString()}`,
    {
      headers: { Authorization: `Token ${apiKey}` },
      next: { revalidate: 86400 },
    },
  );

  if (!res.ok) {
    throw new Error(`ESV API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    passages: string[];
    canonical?: string;
  };

  return {
    ref: data.canonical ?? ref,
    text: (data.passages?.[0] ?? "").trim(),
    copyright:
      "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®).",
    translation: "ESV",
  };
}

export async function fetchPassage(ref: string): Promise<PassageResult> {
  const normalized = ref.trim();
  const cacheKey = normalized.toLowerCase();

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.ESV_API_KEY;
  const result = apiKey
    ? await fetchFromEsv(normalized, apiKey)
    : await fetchFromBibleApi(normalized);

  cacheSet(cacheKey, result);
  return result;
}

export async function fetchPassages(refs: string[]): Promise<PassageResult[]> {
  const unique = Array.from(
    new Set(refs.map((r) => r.trim()).filter(Boolean)),
  );
  return Promise.all(unique.map((ref) => fetchPassage(ref)));
}
