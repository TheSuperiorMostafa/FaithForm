import { notFound, redirect } from "next/navigation";

import { transcriptHref } from "@/lib/sermon-media/hrefs";

export const dynamic = "force-dynamic";

/** Old transcript links (lessons point at a moment with `?t=`) open the recording's transcript in Live > Recordings. */
export default async function OldTranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const rawT = (await searchParams).t;
  const t = Number(Array.isArray(rawT) ? rawT[0] : rawT);
  redirect(transcriptHref(id, rawT === undefined ? null : t));
}
