import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DeleteSeriesButton } from "@/components/sermon-builder/delete-series-button";
import { SeriesTimeline } from "@/components/sermon-builder/series-timeline";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { getSeries } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  const series = await getSeries(id);
  if (!series || series.church_id !== churchId) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Link
        href="/dashboard/sermon-builder"
        className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-accent"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Back
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">{series.title}</h1>
          <p className="text-muted-foreground">{series.theme}</p>
          {series.description && (
            <p className="mt-2 text-sm">{series.description}</p>
          )}
        </div>
        <DeleteSeriesButton
          seriesId={series.id}
          seriesTitle={series.title}
        />
      </div>
      <SeriesTimeline series={series} />
    </div>
  );
}
