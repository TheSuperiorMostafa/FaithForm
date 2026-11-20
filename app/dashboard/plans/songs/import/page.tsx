import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileUp } from "lucide-react";
import { CcliNote } from "@/components/service-plans/songs/ccli-note";
import { SongImporter } from "@/components/service-plans/songs/song-importer";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { IMPORT_DESCRIPTION, IMPORT_TITLE } from "@/lib/service-plans/songs/page-copy";

export const dynamic = "force-dynamic";

export default async function ImportSongsPage() {
  if (await pageFeatureBlocked("service_plans")) return null;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Button variant="link" className="w-fit" nativeButton={false} render={<Link href="/dashboard/plans/songs" />}>
          <ArrowLeft aria-hidden className="size-4" />
          Song library
        </Button>
        <PageHeader title={IMPORT_TITLE} description={IMPORT_DESCRIPTION} icon={FileUp} />
      </div>
      <CcliNote />
      <SongImporter />
    </div>
  );
}
