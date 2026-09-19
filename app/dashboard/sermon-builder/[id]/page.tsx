import { ServicePresentationLinker } from "@/components/live-streaming/service-presentation-linker";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SimpleSermonDetail } from "@/components/sermon-builder/simple-sermon-detail";
import { SermonAppStatus } from "@/components/sermon-builder/sermon-app-status";
import { SermonEditor } from "@/components/sermon-builder/sermon-editor";
import { ShareInAppCard } from "@/components/sermon-builder/share-in-app-card";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { getChurchAuth } from "@/lib/auth/church";
import {
  canAccessFeature,
  getFeatureAccess,
} from "@/lib/features/access";
import { getSlideThemeById } from "@/lib/queries/slide-themes";
import { getLatestAsset, getSermon } from "@/lib/queries/sermons";
import { getActivePresentationVersion } from "@/lib/sermons/v1/presentation";
import type { DiscussionQuestion } from "@/types/sermon";

export const dynamic = "force-dynamic";

export default async function SermonEditorPage({
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

  const isSimple = (sermon.kind ?? "advanced") === "simple";
  const theme = isSimple ? await getSlideThemeById(sermon.theme_id) : null;

  const questionsAsset = isSimple
    ? await getLatestAsset(sermon.id, "discussion_questions")
    : null;
  const questions =
    (questionsAsset?.payload as { questions?: DiscussionQuestion[] } | null)
      ?.questions ?? [];

  // Sharing puts a sermon in front of a congregation, so it is an admin's
  // decision (the server action enforces the same rule). Everyone else sees
  // where the sermon stands rather than a button that fails.
  // `getChurchAuth` is request-cached (the section's feature gate already read
  // it) and impersonation-aware, so a platform admin inside a church is an admin.
  const auth = await getChurchAuth();
  const canShare = Boolean(auth?.isAdmin && auth.churchId === churchId);

  const access = await getFeatureAccess();
  const featuresEnabled = Boolean(
    access &&
      canAccessFeature(access, "sermon_builder") &&
      canAccessFeature(access, "member_app"),
  );

  const presentation = featuresEnabled
    ? await getActivePresentationVersion({
        churchId,
        sermonId: sermon.id,
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/sermon-builder"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to sermons
      </Link>
      {featuresEnabled && (
        <div className="mx-auto w-full max-w-3xl">
          <SermonAppStatus
            sermon={sermon}
            canShare={canShare}
            presentation={presentation}
          />
        </div>
      )}
      {canShare && featuresEnabled && <div className="mx-auto w-full max-w-3xl"><ServicePresentationLinker sermonId={sermon.id} /></div>}
      {isSimple ? (
        <SimpleSermonDetail
          sermon={sermon}
          theme={theme}
          questions={questions}
        />
      ) : (
        <SermonEditor sermon={sermon} />
      )}
      <div className="mx-auto w-full max-w-3xl">
        <ShareInAppCard
          sermon={sermon}
          canShare={canShare}
          featuresEnabled={featuresEnabled}
          presentation={presentation}
        />
      </div>
    </div>
  );
}
