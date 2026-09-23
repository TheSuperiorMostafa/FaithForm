import { GivingSubpageSkeleton } from "@/components/giving/giving-subpage-skeleton";

export default function StatementsLoading() {
  return (
    <GivingSubpageSkeleton
      label="giving statements"
      titleWidth="w-36"
      descriptionWidth="w-64"
      columns={3}
    />
  );
}
