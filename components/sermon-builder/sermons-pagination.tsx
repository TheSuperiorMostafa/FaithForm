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
    <div className="flex items-center justify-between gap-4 pt-2">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} · {total} sermon{total === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        {prevPage ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={pageHref(prevPage)} />}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="size-4" />
            Previous
          </Button>
        )}
        {nextPage ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={pageHref(nextPage)} />}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
