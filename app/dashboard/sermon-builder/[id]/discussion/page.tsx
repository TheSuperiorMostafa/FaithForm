import { redirect, notFound } from "next/navigation";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { DiscussionQuestions } from "@/components/sermon-builder/discussion-questions";
import { PageHeader } from "@/components/ui/page-header";
import {
  DISCUSSION_DESCRIPTION,
  DISCUSSION_TITLE,
} from "@/lib/sermon-builder/page-copy";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { getLatestAsset, getSermon } from "@/lib/queries/sermons";
import type { DiscussionQuestion } from "@/types/sermon";

export const dynamic = "force-dynamic";

export default async function DiscussionPage({
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

  const sermon = await getSermon(id);
  if (!sermon || sermon.church_id !== churchId) notFound();

  const asset = await getLatestAsset(id, "discussion_questions");
  const initial = (asset?.payload as { questions?: DiscussionQuestion[] })
    ?.questions;

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href={`/dashboard/sermon-builder/${id}`} label="Back to the sermon" />
      <PageHeader title={DISCUSSION_TITLE} description={DISCUSSION_DESCRIPTION} />
      <div className="w-full max-w-3xl">
        <DiscussionQuestions sermonId={id} initial={initial} />
      </div>
    </div>
  );
}
