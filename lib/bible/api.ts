import type {
  AvailableTranslations,
  TranslationBookChapter,
  TranslationBooks,
} from "./types";

const BASE = "https://bible.helloao.org/api";

async function bibleFetch<T>(
  path: string,
  revalidate: number,
  retries = 1,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      next: { revalidate },
    });

    if (res.ok) {
      return res.json() as Promise<T>;
    }

    if (attempt === retries) {
      throw new Error(
        `Bible API error ${res.status} for ${path.replace(BASE, "")}`,
      );
    }
  }

  throw new Error(`Bible API failed for ${path}`);
}

export async function getTranslations(): Promise<AvailableTranslations> {
  return bibleFetch<AvailableTranslations>(
    "/available_translations.json",
    86400,
  );
}

export async function getBooks(translation: string): Promise<TranslationBooks> {
  return bibleFetch<TranslationBooks>(`/${translation}/books.json`, 86400);
}

export async function getChapter(
  translation: string,
  book: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  return bibleFetch<TranslationBookChapter>(
    `/${translation}/${book}/${chapter}.json`,
    604800,
  );
}
