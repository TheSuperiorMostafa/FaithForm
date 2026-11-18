import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Presentation } from "lucide-react";
import { CreateLessonPanel } from "@/components/sermon-builder/create-lesson-panel";
import { DeleteSermonButton } from "@/components/sermon-builder/delete-draft-button";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { LESSON_BACK_LABEL } from "@/lib/lesson-builder/page-copy";
import { getLatestAsset, getSermon } from "@/lib/queries/sermons";
import { formatSermonDate } from "@/lib/sermon-builder/sermon-display";
import { getLessonRecordingSource } from "@/lib/sermon-media/lesson-source";
import { isSermonShared } from "@/lib/sermons/v1/share-rules";
import type { DiscussionQuestion, SermonOutline } from "@/types/sermon";

export const dynamic = "force-dynamic";

/**
 * One lesson in Lesson Builder: the full lesson panel (outline, questions,
 * print and PDF). A lesson that belongs to a sermon links back to its slides;
 * one made here can be deleted here.
 */
export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (await pageFeatureBlocked("sermon_builder")) return null;

  const [{ id }, auth] = await Promise.all([params, getChurchAuth()]);
  if (!auth) redirect("/login");

  const lesson = await getSermon(id);
  if (!lesson || lesson.church_id !== auth.churchId) notFound();

  const [questionsAsset, recordingSource] = await Promise.all([
    getLatestAsset(lesson.id, "discussion_questions"),
    getLessonRecordingSource(lesson.id, auth.churchId),
  ]);
  const questions =
    (questionsAsset?.payload as { questions?: DiscussionQuestion[] } | null)?.questions ?? [];

  const fromSermon = (lesson.builder ?? "sermon") === "sermon";
  // A lesson that belongs to a sermon is deleted with the sermon, from its page.
  const canDelete =
    !fromSermon && !isSermonShared(lesson) && (lesson.status === "draft" || auth.isAdmin);

  const description = [
    lesson.scripture_refs.filter(Boolean).join(", "),
    formatSermonDate(lesson.sermon_date),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href="/dashboard/lesson-builder" label={LESSON_BACK_LABEL} />

      <PageHeader
        title={lesson.title}
        description={description || undefined}
        secondary={
          fromSermon ? (
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              render={<Link href={`/dashboard/sermon-builder/${lesson.id}`} />}
            >
              <Presentation aria-hidden className="size-5" />
              Open the sermon&rsquo;s slides
            </Button>
          ) : undefined
        }
      />

      <CreateLessonPanel
        sermonId={lesson.id}
        sermonTitle={lesson.title}
        scriptureRefs={lesson.scripture_refs}
        outline={(lesson.outline as SermonOutline | null) ?? null}
        questions={questions}
        recordingSource={recordingSource}
      />

      {canDelete && (
        <div className="border-t border-border pt-8">
          <DeleteSermonButton
            sermonId={lesson.id}
            sermonTitle={lesson.title}
            kind="lesson"
            redirectTo="/dashboard/lesson-builder"
          />
        </div>
      )}
    </div>
  );
}
