import { GivingSubpageSkeleton } from "@/components/giving/giving-subpage-skeleton";

export default function GiftsLoading() {
  return (
    <GivingSubpageSkeleton
      label="gifts"
      titleWidth="w-24"
      descriptionWidth="w-64"
      columns={5}
    />
  );
}
