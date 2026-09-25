import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SermonList } from "@/components/sermon-builder/sermon-list";
import { SermonsPagination } from "@/components/sermon-builder/sermons-pagination";
import { SeriesList } from "@/components/sermon-builder/series-list";
import { getChurchAuth } from "@/lib/auth/church";
import { listSermons, listSeries } from "@/lib/queries/sermons";
import { SERMONS_DESCRIPTION, SERMONS_TITLE } from "@/lib/sermon-builder/page-copy";
import { listSermonIdsWithSharedSlides } from "@/lib/sermons/v1/presentation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function SermonBuilderPage({ searchParams }: PageProps) {
  const [query, auth] = await Promise.all([searchParams, getChurchAuth()]);
  if (!auth) redirect("/login");

  const churchId = auth.churchId;

  const rawPage = Number(query.page ?? "1");
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const [sermonsResult, series] = await Promise.all([
    listSermons(churchId, { page, pageSize: PAGE_SIZE }),
    listSeries(churchId),
  ]);

  const { rows: sermons, total: sermonTotal } = sermonsResult;
  const totalPages = Math.max(1, Math.ceil(sermonTotal / PAGE_SIZE));

  if (page > totalPages && sermonTotal > 0) {
    redirect(
      totalPages === 1
        ? "/dashboard/sermon-builder"
        : `/dashboard/sermon-builder?page=${totalPages}`,
    );
  }

  const currentPage = Math.min(page, totalPages);

  // Status comes from what members can see, so a sermon taken out of the app
  // reads "Draft" again. Slides are shared separately from notes.
  const withSharedSlides = await listSermonIdsWithSharedSlides({
    churchId,
    sermonIds: sermons.map((s) => s.id),
  });

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={SERMONS_TITLE}
        description={SERMONS_DESCRIPTION}
        icon={BookOpen}
        secondary={
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={<Link href="/dashboard/sermon-builder/series/new" />}
          >
            <Layers aria-hidden className="size-5" />
            New series
          </Button>
        }
        action={
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/dashboard/sermon-builder/new" />}
          >
            <Plus aria-hidden className="size-5" />
            New sermon
          </Button>
        }
      />

      <Tabs defaultValue="sermons">
        <TabsList aria-label="Sermons or series">
          <TabsTrigger value="sermons">Sermons ({sermonTotal})</TabsTrigger>
          <TabsTrigger value="series">Series ({series.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="sermons" className="mt-6 flex flex-col gap-6">
          <SermonList
            sermons={sermons}
            sermonIdsWithSharedSlides={[...withSharedSlides]}
          />
          <SermonsPagination
            page={currentPage}
            totalPages={totalPages}
            total={sermonTotal}
          />
        </TabsContent>
        <TabsContent value="series" className="mt-6">
          <SeriesList series={series} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
