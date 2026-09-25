import { redirect } from "next/navigation";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { SimpleSermonBuilder } from "@/components/sermon-builder/simple-sermon-builder";
import { PageHeader } from "@/components/ui/page-header";
import {
  NEW_SERMON_DESCRIPTION,
  NEW_SERMON_TITLE,
} from "@/lib/sermon-builder/page-copy";
import {
  getCuratedTranslations,
  getDefaultTranslationId,
} from "@/lib/bible/translations";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { getChurchAISettings } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

/**
 * "John 3:16-21" → book, chapter, verses, so a week planned in a series opens
 * with its passage already filled in. Anything unparseable is simply ignored.
 */
function parsePassage(raw: string | undefined): {
  book?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
} {
  if (!raw) return {};
  const match = raw.trim().match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?/);
  if (!match) return {};
  const [, book, chapter, start, end] = match;
  const verseStart = start ? Number(start) : undefined;
  return {
    book: book.trim(),
    chapter: Number(chapter),
    verseStart,
    verseEnd: end ? Number(end) : verseStart,
  };
}

type Props = {
  searchParams: Promise<{
    series?: string;
    topic?: string;
    scripture?: string;
  }>;
};

export default async function NewSermonPage({ searchParams }: Props) {
  const query = await searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  const settings = await getChurchAISettings(churchId);

  // One flow for everyone: build the deck, then "Create lesson" on the deck
  // page adds the outline and discussion questions.
  const translationOptions = await getCuratedTranslations();
  const defaultTranslation = await getDefaultTranslationId(
    settings?.default_translation,
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href="/dashboard/sermon-builder" label="Back to Sermons" />
      <PageHeader title={NEW_SERMON_TITLE} description={NEW_SERMON_DESCRIPTION} />
      <SimpleSermonBuilder
        translationOptions={translationOptions}
        defaultTranslation={defaultTranslation}
        initial={{
          title: query.topic,
          ...parsePassage(query.scripture),
        }}
        seriesId={query.series}
      />
    </div>
  );
}
