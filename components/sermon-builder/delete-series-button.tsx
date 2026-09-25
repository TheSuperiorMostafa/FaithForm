"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteSeriesAction } from "@/app/dashboard/sermon-builder/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";

type DeleteSeriesButtonProps = {
  seriesId: string;
  seriesTitle: string;
  redirectTo?: string;
  className?: string;
};

export function DeleteSeriesButton({
  seriesId,
  seriesTitle,
  redirectTo = "/dashboard/sermon-builder",
  className,
}: DeleteSeriesButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    const ok = await confirmAction({
      title: `Delete "${seriesTitle}"?`,
      description:
        "The series plan is deleted for good. Sermons you already made from it are kept; they just won't be grouped in this series.",
      confirmLabel: "Delete series",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await deleteSeriesAction(seriesId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`"${seriesTitle}" deleted.`);
      router.push(redirectTo);
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      disabled={isPending}
      onClick={handleDelete}
    >
      {isPending ? (
        <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
      ) : (
        <Trash2 aria-hidden className="size-5" />
      )}
      Delete series
    </Button>
  );
}
