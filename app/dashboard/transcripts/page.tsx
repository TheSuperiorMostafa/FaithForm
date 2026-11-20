import { redirect } from "next/navigation";

import { RECORDINGS_BASE_HREF } from "@/lib/sermon-media/hrefs";

export const dynamic = "force-dynamic";

/** Transcripts moved into Live > Recordings: each recording opens its own from More options. */
export default function OldTranscriptsPage() {
  redirect(RECORDINGS_BASE_HREF);
}
