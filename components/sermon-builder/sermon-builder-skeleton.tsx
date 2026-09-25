import { BookOpen, Save } from "lucide-react";
import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

function FieldSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={className}>
      <div className="space-y-2">
        <p className="text-[15px] font-medium leading-none">{label}</p>
        <Skeleton className="h-11 w-full rounded-[10px]" />
      </div>
    </div>
  );
}

/**
 * The sermon form while it loads, for both New sermon and Edit sermon: the
 * same cards, labels and button as `SimpleSermonBuilder`, with only the
 * fields shimmering.
 */
export function SermonBuilderSkeleton({
  backLabel,
  title,
  description,
  saveLabel,
}: {
  backLabel: string;
  title: string;
  description?: string;
  saveLabel: string;
}) {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="sermon form">
      <SermonBackLinkStatic label={backLabel} />
      {description ? (
        <PageHeader title={title} description={description} />
      ) : (
        // PageHeader's markup, with the sermon's own title (data) shimmering.
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h1 className="font-heading text-[28px] font-bold leading-tight text-foreground sm:text-[32px]">
              {title}
            </h1>
            <Skeleton className="h-6 w-64 max-w-full" />
          </div>
        </header>
      )}

      <div className="flex w-full flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sermon details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FieldSkeleton label="Sermon title" />
            <FieldSkeleton label="Sermon date" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
              Bible passage
            </CardTitle>
            <p className="text-[15px] text-muted-foreground">
              Choose the book, chapter and verses. Each verse fills the screen as
              large as it fits.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FieldSkeleton label="Bible translation" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FieldSkeleton label="Book" className="sm:col-span-2" />
              <FieldSkeleton label="Chapter" />
              <FieldSkeleton label="From verse" />
            </div>
            <Skeleton className="h-28 w-full rounded-2xl" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slide theme</CardTitle>
            <p className="text-[15px] text-muted-foreground">
              The background and colours of every slide.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[16/12] w-full rounded-xl" />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col items-start gap-2">
          <span aria-hidden className={buttonVariants({ size: "lg", className: "w-full opacity-50 sm:w-auto" })}>
            <Save className="size-5" />
            {saveLabel}
          </span>
        </div>
      </div>
    </SkeletonContainer>
  );
}
