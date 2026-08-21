import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SocialSnippetsPanel } from "@/components/sermon-builder/social-snippets";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        href={`/dashboard/sermon-builder/${id}`}
        className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-accent"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Back to editor
      </Link>
      <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
        Social snippets
      </h1>
      <p className="text-sm text-muted-foreground">{sermon.title}</p>
      <SocialSnippetsPanel sermonId={id} initial={initial} />
    </div>
  );
}
