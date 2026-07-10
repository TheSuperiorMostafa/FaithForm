import { notFound } from "next/navigation";
import { getChurchBySlug } from "@/lib/queries/giving";
import { getPublishedRecordingForChurch } from "@/lib/stream/recordings";
import { createAdminClient } from "@/lib/supabase/admin";

type PageProps = {
  params: { slug: string; id: string };
};

export default async function VodWatchPage({ params }: PageProps) {
  const church = await getChurchBySlug(params.slug);
  if (!church) notFound();

  const admin = createAdminClient();
  const recording = await getPublishedRecordingForChurch(
    church.churchId,
    params.id,
    admin,
  );
  if (!recording) notFound();

  const { data: signed } = await admin.storage
    .from("stream-recordings")
    .createSignedUrl(recording.storagePath, 60 * 60);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-heading text-2xl font-bold">
        {recording.title ?? "On-demand video"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{church.churchName}</p>
      {signed?.signedUrl ? (
        <video
          className="mt-6 aspect-video w-full rounded-xl bg-black"
          src={signed.signedUrl}
          controls
          playsInline
        />
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Video is processing. Check back soon.
        </p>
      )}
    </div>
  );
}
