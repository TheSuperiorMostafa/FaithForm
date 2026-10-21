import { PageHeader } from "@/components/ui/page-header";
import { SkeletonContainer } from "@/components/ui/skeleton";
import { TextAppCheckContent } from "./text-app-check-content";

export default function CheckTextsLoading() {
  return (
    <SkeletonContainer label="Check your text messages" className="flex w-full flex-col gap-8">
      <PageHeader title="Check your text messages" description="One last step after requesting attendance texts." />
      <TextAppCheckContent />
    </SkeletonContainer>
  );
}
