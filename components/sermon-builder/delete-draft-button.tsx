"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteSermonAction } from "@/app/dashboard/sermon-builder/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DeleteDraftButtonProps = {
  sermonId: string;
  sermonTitle: string;
  redirectTo?: string;
  variant?: "icon" | "outline";
  className?: string;
};

export function DeleteDraftButton({
  sermonId,
  sermonTitle,
  redirectTo,
  variant = "icon",
  className,
}: DeleteDraftButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSermonAction(sermonId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant === "icon" ? "ghost" : "outline"}
        size={variant === "icon" ? "icon" : "sm"}
        className={
          variant === "icon"
            ? `size-8 shrink-0 text-muted-foreground hover:text-destructive ${className ?? ""}`
            : className
        }
        aria-label="Delete draft"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
        {variant === "outline" && "Delete draft"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showClose={!isPending}>
          <DialogHeader>
            <DialogTitle>Delete draft?</DialogTitle>
            <DialogDescription>
              &ldquo;{sermonTitle}&rdquo; will be permanently removed. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="px-6 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={handleDelete}
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
