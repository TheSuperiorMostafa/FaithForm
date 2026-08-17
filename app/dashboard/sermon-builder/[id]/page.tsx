import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SimpleSermonDetail } from "@/components/sermon-builder/simple-sermon-detail";
import { SermonEditor } from "@/components/sermon-builder/sermon-editor";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { getSlideThemeById } from "@/lib/queries/slide-themes";
import { getLatestAsset, getSermon } from "@/lib/queries/sermons";
import type { DiscussionQuestion } from "@/types/sermon";

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
  const theme = isSimple ? await getSlideThemeById(sermon.theme_id) : null;

  const questionsAsset = isSimple
    ? await getLatestAsset(sermon.id, "discussion_questions")
    : null;
  const questions =
    (questionsAsset?.payload as { questions?: DiscussionQuestion[] } | null)
      ?.questions ?? [];

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
        <SimpleSermonDetail
          sermon={sermon}
          theme={theme}
          questions={questions}
        />
      ) : (
        <SermonEditor sermon={sermon} />
      )}
    </div>
  );
}
