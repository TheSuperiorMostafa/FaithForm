import { SermonBuilderSkeleton } from "@/components/sermon-builder/sermon-builder-skeleton";
import { EDIT_SERMON_TITLE } from "@/lib/sermon-builder/page-copy";

/** The sermon's own title is data, so only it shimmers under "Edit sermon". */
export default function EditSermonLoading() {
  return (
    <SermonBuilderSkeleton
      backLabel="Back to the sermon"
      title={EDIT_SERMON_TITLE}
      saveLabel="Save changes"
    />
  );
}
