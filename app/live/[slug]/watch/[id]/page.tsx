import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PublicRecordingPlayer } from "@/components/live-streaming/public-recording-player";
import { getChurchBySlug } from "@/lib/queries/giving";
import { formatDuration } from "@/lib/stream/format";
import { getWebRecording } from "@/lib/stream/web-recordings";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string; id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const church = await getChurchBySlug(slug);
  if (!church) return {};
  const found = await getWebRecording(church.slug, id);
  if (!found) return {};

  return {
    title: `${found.recording.title} — ${church.churchName}`,
    description: found.recording.summary ?? undefined,
    // Unlisted means "not advertised": reachable by link, but never indexed.
    robots: found.recording.listed ? undefined : { index: false, follow: false },
  };
}

/**
 * Watch a past service on the church's website.
 *
 * Only a recording the church published to its website, and that FaithForm
 * has proved playable, is shown here — the same eligibility the app applies.
 * Anything else is a plain 404, so an unpublished service cannot be found by
 * guessing its link.
 */
export default async function PublicRecordingPage({ params }: PageProps) {
  const { slug, id } = await params;
  const church = await getChurchBySlug(slug);
  if (!church) notFound();

  const found = await getWebRecording(church.slug, id);
  if (!found) notFound();
  const { recording, playback } = found;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10">
      <Link
        href={`/live/${church.slug}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {church.churchName}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold">{recording.title}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date(recording.recordedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          {recording.durationSec ? ` · ${formatDuration(recording.durationSec)}` : ""}
          {recording.seriesName ? ` · ${recording.seriesName}` : ""}
        </p>
      </header>

      <PublicRecordingPlayer
        slug={church.slug}
        recordingId={recording.id}
        title={recording.title}
        poster={recording.posterUrl}
        playback={playback}
      />

      {recording.summary ? (
        <p className="whitespace-pre-line text-base leading-relaxed">{recording.summary}</p>
      ) : null}

      {recording.tags.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Topics">
          {recording.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
