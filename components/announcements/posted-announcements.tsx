"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Megaphone, Pencil, RotateCcw, TriangleAlert } from "lucide-react";

import { useAnnouncementComposer } from "@/components/announcements/composer-context";
import { TakeDownButton } from "@/components/announcements/published-switch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ANNOUNCEMENT_STATE_LABEL,
  ANNOUNCEMENT_STATE_TONE,
  announcementState,
  describeDestinations,
  describeWhen,
  type PostedItem,
} from "@/lib/announcements/composer";
import { publishedChannels } from "@/lib/announcements/published-channels";
import type { TakenDownAnnouncement } from "@/lib/announcements/standalone";
import { hasLeftAppFeed } from "@/lib/faithform/feed-window";
import { cn } from "@/lib/utils";

/** Anything that reads like a system message is not shown as it is. */
function plainNote(note: string): string {
  return /error|exception|http|status|\{|pgrst|column|relation|token|graph api/i.test(note)
    ? "Part of this didn't go through. Choose Change to see where it went."
    : note;
}

function isCurrent(item: PostedItem, now: number): boolean {
  const row = item.announcement;
  const channels = publishedChannels(row, {
    queuedForWeeklyEmail: item.queuedForWeeklyEmail,
    now,
  });
  if (channels.facebook.published && channels.facebook.scheduledFor) return true;
  return !hasLeftAppFeed(
    { startAt: row.start_at, endAt: row.end_at, allDay: Boolean(row.all_day) },
    new Date(now),
  );
}

export function PostedAnnouncements({
  items,
  takenDown,
  timeZone,
  isAdmin,
  now,
}: {
  items: PostedItem[];
  takenDown: TakenDownAnnouncement[];
  timeZone: string | null;
  isAdmin: boolean;
  /** The server's clock, so the split below renders the same in the browser. */
  now: number;
}) {
  const { openComposer } = useAnnouncementComposer();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Old "edit" links land here as ?published=<id>: open that announcement.
  useEffect(() => {
    const id = searchParams.get("published");
    if (!id) return;
    const item = items.find((candidate) => candidate.announcement.id === id);
    if (item) openComposer({ kind: "change", item });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("published");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, items, openComposer, pathname, router]);

  const current = items.filter((item) => isCurrent(item, now));
  const earlier = items.filter((item) => !isCurrent(item, now));

  return (
    <section aria-labelledby="posted-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="posted-heading"
        title="Posted and scheduled"
        description="What people can see now, and what's waiting to go out."
      />

      {current.length > 0 ? (
        <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {current.map((item) => (
            <PostedRow
              key={item.announcement.id}
              item={item}
              timeZone={timeZone}
              isAdmin={isAdmin}
              now={now}
              onChange={() => openComposer({ kind: "change", item })}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Megaphone}
          title="Nothing posted right now"
          description="When you post an announcement, it shows here with where it went."
        />
      )}

      {earlier.length > 0 && (
        <Disclosure label={`Earlier announcements (${earlier.length})`}>
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {earlier.map((item) => (
              <PostedRow
                key={item.announcement.id}
                item={item}
                timeZone={timeZone}
                isAdmin={isAdmin}
                now={now}
                onChange={() => openComposer({ kind: "change", item })}
              />
            ))}
          </ul>
        </Disclosure>
      )}

      {takenDown.length > 0 && (
        <Disclosure label={`Taken down (${takenDown.length})`}>
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {takenDown.map((item) => (
              <Row
                key={item.id}
                leading={<Thumb url={item.graphicUrl} />}
                title={item.title}
                subtitle={describeWhen(
                  {
                    startAt: item.startAt,
                    endAt: item.endAt,
                    allDay: item.allDay,
                    undated: item.undated,
                    postedAt: item.takenDownAt,
                  },
                  timeZone,
                ).replace(/^Posted/, "Taken down")}
                status={<StatusBadge tone="neutral">{ANNOUNCEMENT_STATE_LABEL.taken_down}</StatusBadge>}
                actions={
                  <Button variant="outline" onClick={() => openComposer({ kind: "repost", item })}>
                    <RotateCcw aria-hidden />
                    Post again
                  </Button>
                }
              />
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

function PostedRow({
  item,
  timeZone,
  isAdmin,
  now,
  onChange,
}: {
  item: PostedItem;
  timeZone: string | null;
  isAdmin: boolean;
  now: number;
  onChange: () => void;
}) {
  const row = item.announcement;
  const state = announcementState(row, {
    queuedForWeeklyEmail: item.queuedForWeeklyEmail,
    now,
  });
  const channels = publishedChannels(row, { queuedForWeeklyEmail: item.queuedForWeeklyEmail, now });
  const when = describeWhen(
    {
      startAt: row.start_at,
      endAt: row.end_at,
      allDay: Boolean(row.all_day),
      undated: item.undated,
      postedAt: row.published_at,
    },
    timeZone,
  );

  return (
    <Row
      leading={<Thumb url={row.social_graphic_url ?? null} />}
      title={row.title}
      subtitle={`${when} · ${describeDestinations(row, {
        queuedForWeeklyEmail: item.queuedForWeeklyEmail,
        timeZone,
        now,
      })}`}
      note={row.last_publish_error ? plainNote(row.last_publish_error) : null}
      status={
        <StatusBadge tone={ANNOUNCEMENT_STATE_TONE[state]}>
          {ANNOUNCEMENT_STATE_LABEL[state]}
        </StatusBadge>
      }
      actions={
        <>
          <Button variant="outline" onClick={onChange}>
            <Pencil aria-hidden strokeWidth={1.75} />
            Change
          </Button>
          {isAdmin && (
            <TakeDownButton
              announcementId={row.id}
              title={row.title}
              calendarLinked={Boolean(row.google_event_id)}
              facebookIsLive={channels.facebook.published && !channels.facebook.scheduledFor}
            />
          )}
        </>
      }
    />
  );
}

function Row({
  leading,
  title,
  subtitle,
  note,
  status,
  actions,
}: {
  leading: ReactNode;
  title: string;
  subtitle: string;
  note?: string | null;
  status: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="flex min-h-[72px] flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 text-base font-semibold text-foreground">{title}</p>
            {status}
          </div>
          <p className="mt-0.5 text-[15px] text-muted-foreground">{subtitle}</p>
          {note && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {note}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-16 sm:pl-0">{actions}</div>
    </li>
  );
}

function Thumb({ url }: { url: string | null }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="size-12 shrink-0 rounded-xl border border-border object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
    >
      <Megaphone className="size-5" strokeWidth={1.75} />
    </span>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-[15px] font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-5 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
        {open ? `Hide ${label.charAt(0).toLowerCase()}${label.slice(1)}` : `Show ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      </button>
      {open && children}
    </div>
  );
}
