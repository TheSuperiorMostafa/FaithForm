import { Captions } from "lucide-react";

import { LIBRARY_DESCRIPTION, LIBRARY_TITLE } from "@/components/transcripts/transcript-library-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** The church has the section, but the service isn't switched on yet: say so kindly. */
export function TranscriptsSettingUp() {
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={LIBRARY_TITLE} description={LIBRARY_DESCRIPTION} icon={Captions} />
      <EmptyState
        icon={Captions}
        title="Transcripts are being set up for your church"
        description="FaithForm is getting transcripts ready for you. Once they're on, every livestreamed service is written out here automatically. Nothing for you to do yet."
      />
    </div>
  );
}
