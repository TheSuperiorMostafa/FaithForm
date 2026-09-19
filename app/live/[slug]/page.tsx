import Link from "next/link";
import { notFound } from "next/navigation";
import { PlayCircle } from "lucide-react";

import { PublicWatchClient } from "@/components/live-streaming/public-watch-client";
import { getChurchBySlug } from "@/lib/queries/giving";
import { formatDuration } from "@/lib/stream/format";
import { listWebRecordings } from "@/lib/stream/web-recordings";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function LiveWatchPage({ params }: PageProps) {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
  if (!church) notFound();

  // Only services the church published to its website, and only listed ones.
  const recordings = await listWebRecordings(church.slug, 9);

  return (
    <>
      <PublicWatchClient slug={church.slug} />
      {recordings.length > 0 ? (
        <section
          aria-labelledby="past-services"
          className="mx-auto w-full max-w-5xl px-4 pb-16"
        >
          <h2 id="past-services" className="mb-4 font-heading text-xl font-bold">
            Past services
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recordings.map((recording) => (
              <li key={recording.id}>
                <Link
                  href={`/live/${church.slug}/watch/${recording.id}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-video bg-muted">
                    {recording.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={recording.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <PlayCircle className="size-10" aria-hidden />
                      </div>
                    )}
                    {recording.durationSec ? (
                      <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-medium text-white">
                        {formatDuration(recording.durationSec)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-0.5 p-4">
                    <span className="font-semibold group-hover:underline">{recording.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {new Date(recording.recordedAt).toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {recording.seriesName ? ` · ${recording.seriesName}` : ""}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
