import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PublicRecordingPlayer } from "@/components/live-streaming/public-recording-player";
import { getChurchBySlug } from "@/lib/queries/giving";
import { getMediaItem } from "@/lib/stream/media-library";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PLAYBACK_URL_TTL_SECONDS = 60 * 60 * 4;

type PageProps = {
  params: Promise<{ slug: string; id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const church = await getChurchBySlug(slug);
  if (!church) return {};
  const item = await getMediaItem(church.churchId, id);
  if (!item) return {};

  return {
    title: `${item.title ?? "Service"} — ${church.churchName}`,
    // Unlisted means "not advertised": reachable by link, but never indexed.
    robots: item.visibility === "unlisted" ? { index: false, follow: false } : undefined,
  };
}

/**
 * Watch a past service.
 *
 * Public and unlisted recordings both play here — that is what "unlisted"
 * means. The difference is that an unlisted one is never listed or indexed, so
 * it is only reachable by someone the church sent the link to.
 */
export default async function PublicRecordingPage({ params }: PageProps) {
  const { slug, id } = await params;
  const church = await getChurchBySlug(slug);
  if (!church) notFound();

  const item = await getMediaItem(church.churchId, id);
  if (!item) notFound();

  const admin = createAdminClient();
  const { data: signed } = await admin.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(item.storagePath, PLAYBACK_URL_TTL_SECONDS);

  const tags = [
    ...item.tags.speakers,
    ...item.tags.chapters,
    ...item.tags.topics,
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{church.churchName}</p>
        <h1 className="font-heading text-2xl font-bold">
          {item.title ?? "Service recording"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {new Date(item.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          {item.seriesName ? ` · ${item.seriesName}` : ""}
        </p>
      </header>

      <PublicRecordingPlayer
        slug={church.slug}
        recordingId={item.id}
        playbackUrl={signed?.signedUrl ?? null}
      />

      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
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
