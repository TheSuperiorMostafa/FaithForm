import { GroupsSkeleton } from "@/components/groups/skeletons";

/** Every Groups route shares this segment; the skeleton picks the layout from the path. */
export default function LoadingGroups() {
  return <GroupsSkeleton />;
}
