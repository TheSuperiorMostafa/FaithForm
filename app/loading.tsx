import { MarketingLanding } from "@/components/marketing/landing";
import { CurrentHero } from "@/components/marketing/current-hero";
import { DashboardPreviewSkeleton } from "@/components/marketing/dashboard-preview-skeleton";
import { SkeletonContainer } from "@/components/ui/skeleton";
import "./marketing.css";

export default function Loading() {
  return (
    <SkeletonContainer label="FaithForm home">
      <MarketingLanding hero={<CurrentHero preview={<DashboardPreviewSkeleton />} />} />
    </SkeletonContainer>
  );
}
