import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard } from "lucide-react";

import { ClipsStudio } from "@/components/clips/clips-studio";
import { CLIPS_DESCRIPTION, CLIPS_TITLE } from "@/components/clips/format";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";

export const dynamic = "force-dynamic";

export default async function ClipsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;
  if (await pageFeatureBlocked("sermon_media")) return null;

  const [query, auth] = await Promise.all([searchParams, getChurchAuth()]);
  if (!auth) redirect("/login");

  const settings = await getSermonMediaSettings(auth.churchId).catch(() => null);
  if (!settings?.enabled) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title={CLIPS_TITLE} description={CLIPS_DESCRIPTION} icon={Clapperboard} />
        <EmptyState
          icon={Clapperboard}
          title="Clips are being set up"
          description="FaithForm is getting Transcripts & Clips ready for your church. Once it's on, clips from each service will appear here for you to watch and approve."
          action={
            <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
              Back to the dashboard
            </Link>
          }
        />
      </div>
    );
  }

  return <ClipsStudio timezone={auth.churchTimezone} initialView={query.view} />;
}
