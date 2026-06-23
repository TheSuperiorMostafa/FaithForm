import { redirect } from "next/navigation";
import { SeriesPlanner } from "@/components/sermon-builder/series-planner";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
        New series
      </h1>
      <SeriesPlanner />
    </div>
  );
}
