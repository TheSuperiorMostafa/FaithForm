"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, ExternalLink, TriangleAlert } from "lucide-react";
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
import { cn } from "@/lib/utils";

type TakeDownButtonProps = {
  announcementId: string;
  title: string;
  /** True when a Facebook post exists and has already gone live. */
  facebookIsLive?: boolean;
  /** It came from the church calendar, whose event is left as it is. */
  calendarLinked?: boolean;
  /** Runs once it is taken down, before the page refreshes. */
  onTakenDown?: () => void;
  className?: string;
};

/**
 * "Take down": takes a posted announcement out of the app, Monday's email and
 * any scheduled Facebook post, after saying exactly that. The announcement is
 * kept, so it can be changed and posted again.
 */
export function TakeDownButton({
  announcementId,
  title,
  facebookIsLive = false,
  calendarLinked = false,
  onTakenDown,
  className,
}: TakeDownButtonProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn("text-destructive hover:bg-destructive/10 hover:text-destructive", className)}
        onClick={() => setConfirming(true)}
      >
        <EyeOff aria-hidden strokeWidth={1.75} />
        Take down
      </Button>

      <TakeDownDialog
        open={confirming}
        onOpenChange={setConfirming}
        announcementId={announcementId}
        title={title}
        facebookIsLive={facebookIsLive}
        calendarLinked={calendarLinked}
        onTakenDown={onTakenDown}
      />
    </>
  );
}

type TakeDownDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  announcementId: string;
  title: string;
  facebookIsLive?: boolean;
  calendarLinked?: boolean;
  onTakenDown?: () => void;
};

function TakeDownDialog({
  open,
  onOpenChange,
  announcementId,
  title,
  facebookIsLive = false,
  calendarLinked = false,
  onTakenDown,
}: TakeDownDialogProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const setOpen = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
  };

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        const result = await unsubmitAnnouncement(announcementId);

        if (result.error) {
          toast.error(result.error);
          return;
        }

        onOpenChange(false);
        onTakenDown?.();

        if (result.facebookStillLive) {
          toast.warning(
            `“${title}” was taken down. The Facebook post was already live, so it's still up.`,
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
          toast.success(`“${title}” was taken down. You can change it and post it again.`);
        }

        for (const warning of result.warnings ?? []) {
          toast.error(warning, { duration: 10000 });
        }

        router.refresh();
      } catch {
        toast.error("We couldn't reach FaithForm. Nothing was changed. Please try again.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take down this announcement?</DialogTitle>
          <DialogDescription className="text-base">
            <span className="font-semibold text-foreground">{title}</span> comes
            down and goes back to your list, so you can change it and post it
            again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 py-5 text-[15px]">
          <ul className="flex flex-col gap-2 text-muted-foreground">
            <Bullet>Removed from the FaithForm app right away.</Bullet>
            <Bullet>Removed from this week&apos;s email.</Bullet>
            <Bullet>
              {facebookIsLive
                ? "The Facebook post is already live and stays up."
                : "Any scheduled Facebook post is cancelled."}
            </Bullet>
            {calendarLinked && <Bullet>Your calendar event is not changed.</Bullet>}
          </ul>

          {facebookIsLive && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>
                People may have already seen the Facebook post. Delete it on
                Facebook yourself if you want it gone.
                <ExternalLink className="ml-1 inline size-3.5" strokeWidth={1.75} aria-hidden />
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Keep it posted
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "Taking down…" : "Take down"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className="text-accent">
        •
      </span>
      {children}
    </li>
  );
}
