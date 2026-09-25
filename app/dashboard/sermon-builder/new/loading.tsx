import { SermonBuilderSkeleton } from "@/components/sermon-builder/sermon-builder-skeleton";
import {
  NEW_SERMON_DESCRIPTION,
  NEW_SERMON_TITLE,
} from "@/lib/sermon-builder/page-copy";

export default function NewSermonLoading() {
  return (
    <SermonBuilderSkeleton
      backLabel="Back to Sermons"
      title={NEW_SERMON_TITLE}
      description={NEW_SERMON_DESCRIPTION}
      saveLabel="Save sermon"
    />
  );
}
