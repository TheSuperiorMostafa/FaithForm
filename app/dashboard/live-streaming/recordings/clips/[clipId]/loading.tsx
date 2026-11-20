import { ArrowLeft } from "lucide-react";

import { CLIP_EDITOR_DESCRIPTION, CLIP_EDITOR_TITLE } from "@/components/clips/format";
import { ClipEditorBodySkeleton } from "@/components/sermon-media/clip-editor-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the clip editor page: back link, header, then the preview and edit
 * cards (left) beside the Facebook text, save, final video and approval cards
 * (right). Labels are real text; only the clip's data shimmers.
 */
export default function RecordingClipLoading() {
  return (
    <SkeletonContainer label="clip" className="flex w-full flex-col gap-8">
      <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Back to Clips
      </span>
      <PageHeader as="h2" title={CLIP_EDITOR_TITLE} description={CLIP_EDITOR_DESCRIPTION} />
      <ClipEditorBodySkeleton standalone={false} />
    </SkeletonContainer>
  );
}
