import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SimpleSermonBuilder } from "@/components/sermon-builder/simple-sermon-builder";
import { getCuratedTranslations, getDefaultTranslationId } from "@/lib/bible/translations";
import { parseScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { getChurchAISettings, getSermon } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

export default async function EditSimpleSermonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  const sermon = await getSermon(id);
  if (!sermon || sermon.church_id !== churchId) notFound();
  if ((sermon.kind ?? "advanced") !== "simple") notFound();

  const settings = await getChurchAISettings(churchId);
  const translationOptions = await getCuratedTranslations();
  const defaultTranslation = await getDefaultTranslationId(
    settings?.default_translation,
  );

  const passages = sermon.scripture_refs
    .map((ref) => {
      const parsed = parseScriptureRef(ref);
      if (!parsed) return null;
      return {
        ref,
        book: parsed.bookName,
        chapter: parsed.chapter,
        verseStart: parsed.verseStart,
        verseEnd: parsed.verseEnd,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/dashboard/sermon-builder/${sermon.id}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to slide deck
      </Link>
      <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
        Edit slide deck
      </h1>
      <SimpleSermonBuilder
        translationOptions={translationOptions}
        defaultTranslation={defaultTranslation}
        editSermon={{
          id: sermon.id,
          title: sermon.title,
          translation: sermon.translation ?? defaultTranslation,
          themeId: sermon.theme_id ?? "midnight",
          sermonDate: sermon.sermon_date,
          passages,
        }}
      />
    </div>
  );
}
