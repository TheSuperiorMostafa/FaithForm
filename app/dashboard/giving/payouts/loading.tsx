import { GivingSubpageSkeleton } from "@/components/giving/giving-subpage-skeleton";

export default function PayoutsLoading() {
  return (
    <GivingSubpageSkeleton
      label="payouts"
      titleWidth="w-32"
      descriptionWidth="w-72"
      columns={4}
    />
  );
}
