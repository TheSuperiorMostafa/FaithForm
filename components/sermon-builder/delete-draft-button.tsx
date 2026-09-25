"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteSermonAction } from "@/app/dashboard/sermon-builder/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";

type DeleteSermonButtonProps = {
  sermonId: string;
  sermonTitle: string;
  redirectTo?: string;
  /** It was in the app once: say so in the confirmation. */
  wasPublished?: boolean;
  className?: string;
};

/**
 * Deletes a sermon for good, after a confirmation that names it. The server
 * decides who may (see `deleteSermonAction`); a refusal is shown as a toast.
 */
export function DeleteSermonButton({
  sermonId,
  sermonTitle,
  redirectTo,
  wasPublished = false,
  className,
}: DeleteSermonButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    const ok = await confirmAction({
      title: `Delete "${sermonTitle}"?`,
      description: wasPublished
        ? "The sermon, its slides, its lesson and every earlier version shared in the app are deleted for good. This can't be undone."
        : "The sermon, its slides and its lesson are deleted for good. This can't be undone.",
      confirmLabel: "Delete sermon",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await deleteSermonAction(sermonId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`"${sermonTitle}" deleted.`);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      disabled={isPending}
      onClick={handleDelete}
    >
      {isPending ? (
        <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
      ) : (
        <Trash2 aria-hidden className="size-5" />
      )}
      Delete sermon
    </Button>
  );
}

/** Older name, kept for any import that still uses it. */
export const DeleteDraftButton = DeleteSermonButton;
