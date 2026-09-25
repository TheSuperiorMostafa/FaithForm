import { redirect, notFound } from "next/navigation";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { SocialSnippetsPanel } from "@/components/sermon-builder/social-snippets";
import { PageHeader } from "@/components/ui/page-header";
import {
  SOCIAL_POSTS_DESCRIPTION,
  SOCIAL_POSTS_TITLE,
} from "@/lib/sermon-builder/page-copy";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { getLatestAsset, getSermon } from "@/lib/queries/sermons";
import type { SocialSnippets } from "@/types/sermon";

export const dynamic = "force-dynamic";

export default async function SocialPage({
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

  const asset = await getLatestAsset(id, "social_snippet");
  const initial = asset?.payload as SocialSnippets | undefined;

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href={`/dashboard/sermon-builder/${id}`} label="Back to the sermon" />
      <PageHeader title={SOCIAL_POSTS_TITLE} description={SOCIAL_POSTS_DESCRIPTION} />
      <SocialSnippetsPanel sermonId={id} initial={initial} />
    </div>
  );
}
