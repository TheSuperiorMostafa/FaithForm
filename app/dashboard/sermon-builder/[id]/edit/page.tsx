import { redirect, notFound } from "next/navigation";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { SimpleSermonBuilder } from "@/components/sermon-builder/simple-sermon-builder";
import { getCuratedTranslations, getDefaultTranslationId } from "@/lib/bible/translations";
import { PageHeader } from "@/components/ui/page-header";
import { EDIT_SERMON_TITLE } from "@/lib/sermon-builder/page-copy";
import { parseScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
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
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href={`/dashboard/sermon-builder/${sermon.id}`} label="Back to the sermon" />
      <PageHeader title={EDIT_SERMON_TITLE} description={sermon.title} />
      <SimpleSermonBuilder
        translationOptions={translationOptions}
        defaultTranslation={defaultTranslation}
        editSermon={{
          id: sermon.id,
          title: sermon.title,
          translation: sermon.translation ?? defaultTranslation,
          themeId: sermon.theme_id ?? "midnight",
          sermonDate: sermon.sermon_date,
          updatedAt: sermon.updated_at,
          passages,
        }}
      />
    </div>
  );
}
