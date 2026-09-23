import { GivingSubpageSkeleton } from "@/components/giving/giving-subpage-skeleton";

export default function DonorsLoading() {
  return (
    <GivingSubpageSkeleton
      label="donors"
      titleWidth="w-28"
      descriptionWidth="w-80"
      columns={3}
    />
  );
}
