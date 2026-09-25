import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type SermonsPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
};

export function SermonsPagination({
  page,
  totalPages,
  total,
}: SermonsPaginationProps) {
  if (totalPages <= 1) return null;

  const prevPage = page > 1 ? page - 1 : null;
  const nextPage = page < totalPages ? page + 1 : null;

  function pageHref(p: number) {
    return p === 1
      ? "/dashboard/sermon-builder"
      : `/dashboard/sermon-builder?page=${p}`;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-[15px] text-muted-foreground">
        Page {page} of {totalPages} · {total} sermon{total === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        {prevPage ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={pageHref(prevPage)} />}
          >
            <ChevronLeft aria-hidden className="size-5" />
            Previous
          </Button>
        ) : (
          <Button variant="outline" disabled>
            <ChevronLeft aria-hidden className="size-5" />
            Previous
          </Button>
        )}
        {nextPage ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={pageHref(nextPage)} />}
          >
            Next
            <ChevronRight aria-hidden className="size-5" />
          </Button>
        ) : (
          <Button variant="outline" disabled>
            Next
            <ChevronRight aria-hidden className="size-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
