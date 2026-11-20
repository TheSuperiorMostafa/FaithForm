import { TranscriptDetailSkeletonBody } from "@/components/transcripts/transcript-detail-skeleton";
import { SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the transcript page under Live > Recordings: back link ("Back to
 * the recording"), title, player and sermon times beside the transcript.
 * Labels and buttons are real text; only the recording's data shimmers.
 */
export default function RecordingTranscriptLoading() {
  return (
    <SkeletonContainer label="transcript" className="flex w-full flex-col gap-8">
      <TranscriptDetailSkeletonBody />
    </SkeletonContainer>
  );
}
