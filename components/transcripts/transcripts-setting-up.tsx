import Link from "next/link";
import { Captions } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { recordingPageHref } from "@/lib/sermon-media/hrefs";

/** The church has the feature, but the service isn't switched on yet: say so kindly. */
export function TranscriptsSettingUp({ recordingId }: { recordingId: string }) {
  return (
    <EmptyState
      icon={Captions}
      title="Transcripts are being set up for your church"
      description="FaithForm is getting transcripts ready for you. Once they're on, every livestreamed service is written out automatically. Nothing for you to do yet."
      action={
        <Link href={recordingPageHref(recordingId)} className={buttonVariants({ variant: "outline" })}>
          Back to the recording
        </Link>
      }
    />
  );
}
