"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteSeriesAction } from "@/app/dashboard/sermon-builder/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DeleteSeriesButtonProps = {
  seriesId: string;
  seriesTitle: string;
  redirectTo?: string;
  variant?: "icon" | "outline";
  className?: string;
};

export function DeleteSeriesButton({
  seriesId,
  seriesTitle,
  redirectTo = "/dashboard/sermon-builder",
  variant = "outline",
  className,
}: DeleteSeriesButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSeriesAction(seriesId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(redirectTo);
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
        aria-label="Delete series"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
        {variant === "outline" && "Delete series"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showClose={!isPending}>
          <DialogHeader>
            <DialogTitle>Delete series?</DialogTitle>
            <DialogDescription>
              &ldquo;{seriesTitle}&rdquo; will be permanently removed. Linked
              sermons will stay in your library but won&apos;t be grouped in this
              series. This cannot be undone.
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
