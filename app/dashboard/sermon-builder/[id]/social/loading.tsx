import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import {
  SOCIAL_POSTS_DESCRIPTION,
  SOCIAL_POSTS_TITLE,
} from "@/lib/sermon-builder/page-copy";

const CHANNELS = ["Instagram", "Facebook", "X (Twitter)", "Email"];

export default function SocialPostsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="social posts">
      <SermonBackLinkStatic label="Back to the sermon" />
      <PageHeader title={SOCIAL_POSTS_TITLE} description={SOCIAL_POSTS_DESCRIPTION} />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-11 w-48 rounded-[10px]" />
          <p className="text-[15px] text-muted-foreground">
            Nothing is posted for you. Copy a post and paste it where you share.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {CHANNELS.map((label) => (
            <Card key={label}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <SkeletonText lines={3} />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </SkeletonContainer>
  );
}
