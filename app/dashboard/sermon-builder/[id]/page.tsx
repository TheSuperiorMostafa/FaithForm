import { redirect, notFound } from "next/navigation";
import { ServicePresentationLinker } from "@/components/live-streaming/service-presentation-linker";
import { DeleteSermonButton } from "@/components/sermon-builder/delete-draft-button";
import { SermonBackLink } from "@/components/sermon-builder/sermon-back-link";
import { SermonDetailTabs } from "@/components/sermon-builder/sermon-detail-tabs";
import {
  PublishToAppButton,
  RemoveFromAppButton,
} from "@/components/sermon-builder/share-in-app-card";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { getChurchAuth } from "@/lib/auth/church";
import {
  canAccessFeature,
  getFeatureAccess,
} from "@/lib/features/access";
import { getLatestAsset, getSermon } from "@/lib/queries/sermons";
import {
  formatSermonDate,
  parseSermonDetailTab,
  sermonDisplayStatus,
} from "@/lib/sermon-builder/sermon-display";
import { getActivePresentationVersion } from "@/lib/sermons/v1/presentation";
import {
  isPresentationShared,
  isSermonShared,
  ONLY_ADMINS_CAN_SHARE,
  sermonAudienceLabel,
} from "@/lib/sermons/v1/share-rules";
import type { DiscussionQuestion, SocialSnippets } from "@/types/sermon";

export const dynamic = "force-dynamic";

export default async function SermonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
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

  const [questionsAsset, socialAsset] = await Promise.all([
    isSimple ? getLatestAsset(sermon.id, "discussion_questions") : Promise.resolve(null),
    getLatestAsset(sermon.id, "social_snippet"),
  ]);
  const questions =
    (questionsAsset?.payload as { questions?: DiscussionQuestion[] } | null)
      ?.questions ?? [];
  const socialInitial = (socialAsset?.payload as SocialSnippets | null) ?? undefined;

  // Publishing puts a sermon in front of a congregation, so it is an admin's
  // decision (the server action enforces the same rule). Everyone else sees
  // where the sermon stands rather than a button that fails.
  // `getChurchAuth` is request-cached (the section's feature gate already read
  // it) and impersonation-aware, so a platform admin inside a church is an admin.
  const auth = await getChurchAuth();
  const isAdmin = Boolean(auth?.isAdmin && auth.churchId === churchId);
  const canShare = isAdmin;

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

  // What members can see decides the badge, not the builder's own column,
  // which stays "published" after a sermon is taken out of the app.
  const notesShared = isSermonShared(sermon);
  const slidesShared = Boolean(presentation && isPresentationShared(presentation));
  const status = sermonDisplayStatus({ notesShared, slidesShared });
  const audience = sermonAudienceLabel(
    notesShared ? sermon.mobile_visibility : (presentation?.mobile_visibility ?? null),
  );

  // Drafts can be deleted by anyone who can build sermons. A sermon that was
  // published is an admin's to delete, and only once it is out of the app
  // (`deleteSermonAction` checks the same).
  const canDelete = !status.inApp && (sermon.status === "draft" || isAdmin);

  const description = [
    formatSermonDate(sermon.sermon_date),
    sermon.scripture_refs.filter(Boolean).join(" · "),
    sermon.translation,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex w-full flex-col gap-8">
      <SermonBackLink href="/dashboard/sermon-builder" label="Back to Sermons" />

      <div className="flex flex-col gap-4">
        <PageHeader
          title={sermon.title}
          description={description || undefined}
          action={
            featuresEnabled && canShare ? (
              <PublishToAppButton sermon={sermon} presentation={presentation} />
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={status.tone} size="lg">
            {status.label}
          </StatusBadge>
          {status.inApp && audience && (
            <span className="text-[15px] text-muted-foreground">{audience}</span>
          )}
          {featuresEnabled && canShare && (
            <RemoveFromAppButton sermon={sermon} presentation={presentation} />
          )}
          {featuresEnabled && !canShare && (
            <span className="text-[15px] text-muted-foreground">{ONLY_ADMINS_CAN_SHARE}</span>
          )}
        </div>
      </div>

      <SermonDetailTabs
        sermon={sermon}
        questions={questions}
        socialInitial={socialInitial}
        initialTab={parseSermonDetailTab(query.tab)}
      />

      {((canShare && featuresEnabled) || canDelete || (status.inApp && isAdmin)) && (
        <div className="flex flex-col gap-4 border-t border-border pt-8">
          {canShare && featuresEnabled && (
            <AdvancedSection
              title="Sermon slides & livestream"
              description="Let people open these slides while they watch a service. The slides need to be in the app first."
            >
              <ServicePresentationLinker sermonId={sermon.id} bare />
            </AdvancedSection>
          )}
          {canDelete ? (
            <div>
              <DeleteSermonButton
                sermonId={sermon.id}
                sermonTitle={sermon.title}
                wasPublished={sermon.status !== "draft"}
                redirectTo="/dashboard/sermon-builder"
              />
            </div>
          ) : status.inApp && isAdmin ? (
            <p className="text-[15px] text-muted-foreground">
              To delete this sermon, remove it from the app first.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
