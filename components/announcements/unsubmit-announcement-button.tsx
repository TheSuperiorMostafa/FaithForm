"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { unsubmitAnnouncement } from "@/app/dashboard/announcements/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type UnsubmitAnnouncementButtonProps = {
  announcementId: string;
  title: string;
  /** True when a Facebook post exists and has already gone live. */
  facebookIsLive?: boolean;
  size?: "sm" | "xs";
  className?: string;
};

export function UnsubmitAnnouncementButton({
  announcementId,
  title,
  facebookIsLive = false,
  size = "sm",
  className,
}: UnsubmitAnnouncementButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await unsubmitAnnouncement(announcementId);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setOpen(false);

      if (result.facebookStillLive) {
        toast.warning(
          "Unsubmitted — the Facebook post is already live and was left up.",
          result.facebookUrl
            ? {
                action: {
                  label: "View post",
                  onClick: () => window.open(result.facebookUrl, "_blank"),
                },
                duration: 10000,
              }
            : { duration: 10000 },
        );
      } else {
        toast.success("Unsubmitted — back in the pending queue.");
      }

      for (const warning of result.warnings ?? []) {
        toast.error(warning, { duration: 10000 });
      }

      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <RotateCcw className="size-4" strokeWidth={1.75} />
        Unsubmit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unsubmit this announcement?</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{title}</span> goes
              back to the pending queue so you can edit and submit it again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 px-6 py-5 text-sm">
            <ul className="flex flex-col gap-2 text-muted-foreground">
              <li className="flex gap-2">
                <span aria-hidden className="text-accent">
                  •
                </span>
                Removed from this week&apos;s Gmail draft.
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-accent">
                  •
                </span>
                {facebookIsLive
                  ? "The Facebook post is already live and stays up."
                  : "Any scheduled Facebook post is cancelled."}
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-accent">
                  •
                </span>
                The Google Calendar event is not changed.
              </li>
            </ul>

            {facebookIsLive && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span>
                  Members may have already seen the Facebook post. Delete it from
                  Facebook yourself if you want it gone.
                  <ExternalLink
                    className="ml-1 inline size-3"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Unsubmitting…" : "Unsubmit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
