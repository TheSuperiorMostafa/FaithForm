import { Skeleton } from "@/components/ui/skeleton";

export function VideoPreviewSkeleton() {
  return <div className="marketing-hero-media"><div className="marketing-hero-video-frame"><Skeleton className="h-full w-full rounded-none" /></div></div>;
}
