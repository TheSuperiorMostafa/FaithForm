import { redirect, notFound } from "next/navigation";
import { DeleteSeriesButton } from "@/components/sermon-builder/delete-series-button";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { SeriesTimeline } from "@/components/sermon-builder/series-timeline";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
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
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href="/dashboard/sermon-builder" label="Back to Sermons" />
      <PageHeader
        title={series.title}
        description={
          <>
            {series.theme}
            {series.description && (
              <span className="mt-1 block text-[15px]">{series.description}</span>
            )}
          </>
        }
      />
      <SeriesTimeline series={series} />
      <div className="border-t border-border pt-8">
        <DeleteSeriesButton seriesId={series.id} seriesTitle={series.title} />
      </div>
    </div>
  );
}
