import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap, Plus } from "lucide-react";
import { LessonList } from "@/components/lesson-builder/lesson-list";
import { SermonsPagination } from "@/components/sermon-builder/sermons-pagination";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { LESSONS_DESCRIPTION, LESSONS_TITLE } from "@/lib/lesson-builder/page-copy";
import { listLessonIdsFromRecordings } from "@/lib/lesson-builder/sources";
import { listSermons } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const BASE_PATH = "/dashboard/lesson-builder";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function LessonBuilderPage({ searchParams }: PageProps) {
  if (await pageFeatureBlocked("sermon_builder")) return null;

  const [query, auth] = await Promise.all([searchParams, getChurchAuth()]);
  if (!auth) redirect("/login");

  const churchId = auth.churchId;
  const rawPage = Number(query.page ?? "1");
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  // Lessons made here, plus every sermon that has made its lesson.
  const { rows: lessons, total } = await listSermons(churchId, {
    page,
    pageSize: PAGE_SIZE,
    builder: "lesson",
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (page > totalPages && total > 0) {
    redirect(totalPages === 1 ? BASE_PATH : `${BASE_PATH}?page=${totalPages}`);
  }

  const fromRecordings = await listLessonIdsFromRecordings(
    churchId,
    lessons.map((lesson) => lesson.id),
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={LESSONS_TITLE}
        description={LESSONS_DESCRIPTION}
        icon={GraduationCap}
        action={
          <Button size="lg" nativeButton={false} render={<Link href={`${BASE_PATH}/new`} />}>
            <Plus aria-hidden className="size-5" />
            New lesson
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        <LessonList lessons={lessons} lessonIdsFromRecordings={[...fromRecordings]} />
        <SermonsPagination
          page={Math.min(page, totalPages)}
          totalPages={totalPages}
          total={total}
          basePath={BASE_PATH}
          noun="lesson"
        />
      </div>
    </div>
  );
}
