import { redirect } from "next/navigation";
import { NewLessonForm } from "@/components/lesson-builder/new-lesson-form";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getCuratedTranslations,
  getDefaultTranslationId,
} from "@/lib/bible/translations";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import {
  LESSON_BACK_LABEL,
  NEW_LESSON_DESCRIPTION,
  NEW_LESSON_TITLE,
} from "@/lib/lesson-builder/page-copy";
import { getChurchAISettings, listSeries } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

export default async function NewLessonPage() {
  if (await pageFeatureBlocked("sermon_builder")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [settings, translationOptions, series] = await Promise.all([
    getChurchAISettings(auth.churchId),
    getCuratedTranslations(),
    listSeries(auth.churchId),
  ]);
  const defaultTranslation = await getDefaultTranslationId(settings?.default_translation);

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href="/dashboard/lesson-builder" label={LESSON_BACK_LABEL} />
      <PageHeader title={NEW_LESSON_TITLE} description={NEW_LESSON_DESCRIPTION} />
      <NewLessonForm
        translationOptions={translationOptions}
        defaultTranslation={defaultTranslation}
        series={series.map((s) => ({ id: s.id, title: s.title }))}
      />
    </div>
  );
}
