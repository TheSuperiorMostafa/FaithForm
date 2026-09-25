import { redirect } from "next/navigation";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { SeriesPlanner } from "@/components/sermon-builder/series-planner";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { NEW_SERIES_DESCRIPTION, NEW_SERIES_TITLE } from "@/lib/sermon-builder/page-copy";

export const dynamic = "force-dynamic";

export default async function NewSeriesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href="/dashboard/sermon-builder" label="Back to Sermons" />
      <PageHeader title={NEW_SERIES_TITLE} description={NEW_SERIES_DESCRIPTION} />
      <SeriesPlanner />
    </div>
  );
}
