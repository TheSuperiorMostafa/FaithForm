import { GivingSubpageSkeleton } from "@/components/giving/giving-subpage-skeleton";

export default function RecurringLoading() {
  return (
    <GivingSubpageSkeleton
      label="recurring gifts"
      titleWidth="w-36"
      descriptionWidth="w-72"
      columns={5}
    />
  );
}
