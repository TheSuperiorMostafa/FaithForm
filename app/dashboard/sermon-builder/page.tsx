import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SermonList } from "@/components/sermon-builder/sermon-list";
import { SermonsPagination } from "@/components/sermon-builder/sermons-pagination";
import { SeriesList } from "@/components/sermon-builder/series-list";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { getChurchAISettings, listSermons, listSeries } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function SermonBuilderPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  const rawPage = Number(query.page ?? "1");
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const [sermonsResult, series, settings] = await Promise.all([
    listSermons(churchId, { page, pageSize: PAGE_SIZE }),
    listSeries(churchId),
    getChurchAISettings(churchId),
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
            Sermon Builder
          </h1>
          <p className="text-sm text-muted-foreground">
            Scripture slide decks with themed PowerPoint exports — then turn any
            deck into a lesson.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/sermon-builder/series/new" />}
          >
            New series
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/sermon-builder/new" />}
          >
            <Plus className="size-4" strokeWidth={1.75} />
            New sermon
          </Button>
        </div>
      </div>

      <Tabs defaultValue="sermons">
        <TabsList>
          <TabsTrigger value="sermons">Sermons ({sermonTotal})</TabsTrigger>
          <TabsTrigger value="series">Series ({series.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="sermons" className="flex flex-col gap-4">
          <SermonList sermons={sermons} />
          <SermonsPagination
            page={currentPage}
            totalPages={totalPages}
            total={sermonTotal}
          />
        </TabsContent>
        <TabsContent value="series">
          <SeriesList series={series} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
