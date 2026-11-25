"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { dismissWhatsNew } from "@/app/dashboard/whats-new-actions";
import type { PendingWhatsNew } from "@/lib/releases/pending";
import { cn } from "@/lib/utils";

const NUMBER_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function splitTitle(title: string): { lead: string; number: string | null } {
  const match = /^(.*?)\s*(\d{1,3})$/.exec(title.trim());
  return match && match[1] ? { lead: match[1], number: match[2] } : { lead: title, number: null };
}

function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function summaryFor(count: number): string {
  if (count === 1) return "One new thing your church can use today.";
  const word = NUMBER_WORDS[count] ?? String(count);
  return `${word} new things your church can use today.`;
}

/**
 * The "What's new" pop-up. Shown once per release: closing it in any way, or
 * following one of its links, remembers that this person has seen every item
 * in it, on every device.
 */
export function WhatsNewDialog({ release }: { release: PendingWhatsNew }) {
  const [open, setOpen] = useState(true);
  const saved = useRef(false);
  const titleId = useId();
  const summaryId = useId();
  const { lead, number } = splitTitle(release.title);
  const when = formatReleaseDate(release.date);

  const close = () => {
    if (!saved.current) {
      saved.current = true;
      // A failed save only means the pop-up comes back next time; the page
      // they were going to must not wait on it.
      void dismissWhatsNew(release.itemIds).catch(() => undefined);
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        showClose={false}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        className={cn(
          "max-w-2xl overflow-hidden rounded-3xl border-0 shadow-[0_30px_80px_rgba(0,20,45,0.35)]",
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-4 motion-safe:duration-300",
        )}
      >
        <header className="relative shrink-0 overflow-hidden border-b-[6px] border-brand-gold bg-brand-navy px-6 pb-6 pt-5 text-white sm:px-10 sm:pb-8 sm:pt-7 [@media(max-height:620px)]:pb-4 [@media(max-height:620px)]:pt-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-brand-gold sm:text-sm sm:tracking-[0.18em]">
              What&apos;s new{when ? <span className="whitespace-nowrap font-semibold text-white/70"> · {when}</span> : null}
            </p>
            <button
              type="button"
              onClick={close}
              className="-mr-3 flex size-11 shrink-0 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold motion-reduce:transition-none"
              aria-label="Close what's new"
            >
              <X className="size-5" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <h2
            id={titleId}
            className="mt-3 flex flex-wrap items-end gap-x-4 font-heading font-extrabold leading-none tracking-tight [@media(max-height:620px)]:mt-1"
          >
            <span className="pb-[0.35rem] text-[2.6rem] sm:pb-3 sm:text-6xl [@media(max-height:620px)]:pb-1 [@media(max-height:620px)]:text-4xl">
              {lead}
            </span>
            {/* Collapsed by the flex layout; keeps the spoken name "Update 14". */}
            {number ? " " : null}
            {number ? (
              <span className="text-[6rem] leading-[0.78] tracking-tighter text-brand-gold sm:text-[8.5rem] [@media(max-height:620px)]:text-[4rem]">
                {number}
              </span>
            ) : null}
          </h2>

          <p id={summaryId} className="mt-5 max-w-md text-lg font-medium leading-snug text-white/85 sm:text-xl [@media(max-height:620px)]:mt-2 [@media(max-height:620px)]:text-base">
            {summaryFor(release.items.length)}
          </p>
        </header>

        <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-6 sm:px-10">
          <ol className="divide-y divide-border">
            {release.items.map((item, index) => {
              const headingId = `${titleId}-${index}`;
              return (
                <li key={item.id} className="grid grid-cols-[2.75rem_1fr] gap-x-3 py-6 sm:grid-cols-[3.75rem_1fr] sm:gap-x-4 sm:py-7">
                  <span
                    aria-hidden
                    className="font-heading text-[2rem] font-extrabold leading-none tabular-nums tracking-tight text-brand-gold sm:text-[2.6rem]"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <h3 id={headingId} className="font-heading text-xl font-bold leading-snug text-foreground sm:text-[1.35rem]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground sm:text-base">{item.body}</p>
                    {item.link ? (
                      <Link
                        href={item.link.href}
                        onClick={close}
                        aria-describedby={headingId}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4 gap-2 text-[15px]")}
                      >
                        {item.link.label}
                        <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-secondary/60 px-6 py-4 sm:px-10">
          <Button size="lg" onClick={close} className="w-full sm:w-auto sm:min-w-40">
            Got it
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
