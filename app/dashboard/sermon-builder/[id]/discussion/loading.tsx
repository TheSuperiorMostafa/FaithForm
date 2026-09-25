import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import {
  DISCUSSION_DESCRIPTION,
  DISCUSSION_TITLE,
} from "@/lib/sermon-builder/page-copy";

export default function DiscussionLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="discussion questions">
      <SermonBackLinkStatic label="Back to the sermon" />
      <PageHeader title={DISCUSSION_TITLE} description={DISCUSSION_DESCRIPTION} />
      <div className="w-full max-w-3xl">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-11 w-48 rounded-[10px]" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-28" />
                </CardHeader>
                <CardContent>
                  <SkeletonText lines={2} size="lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
