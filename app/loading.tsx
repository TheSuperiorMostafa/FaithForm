import { MarketingLanding } from "@/components/marketing/landing";
import { SkeletonContainer } from "@/components/ui/skeleton";
import "./marketing.css";

export default function Loading() {
  return (
    <SkeletonContainer label="FaithForm home">
      <MarketingLanding loading />
    </SkeletonContainer>
  );
}
