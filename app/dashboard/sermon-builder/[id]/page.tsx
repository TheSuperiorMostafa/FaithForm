import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SimpleSermonDetail } from "@/components/sermon-builder/simple-sermon-detail";
import { SermonEditor } from "@/components/sermon-builder/sermon-editor";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { getSermon } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

export default async function SermonEditorPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  const sermon = await getSermon(params.id);
  if (!sermon || sermon.church_id !== churchId) notFound();

  const isSimple = (sermon.kind ?? "advanced") === "simple";

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/sermon-builder"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to sermons
      </Link>
      {isSimple ? (
        <SimpleSermonDetail sermon={sermon} />
      ) : (
        <SermonEditor sermon={sermon} />
      )}
    </div>
  );
}
