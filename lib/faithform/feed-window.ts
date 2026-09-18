/**
 * When an announcement leaves the app's Home feed.
 *
 * The TypeScript twin of the rule `mobile_announcement_feed` applies in SQL
 * (migration 0076): an event is listed until its end time, and one without an
 * end time until a day after it starts — two for an all-day event, whose
 * midnight-UTC start has to cover the whole local day in every zone a church
 * is in.
 *
 * Kept free of server imports so the dashboard form can say, before anything
 * is published, that an event which already happened will not be on Home.
 * The Schedule calendar still shows it in its own month; only the feed, and a
 * notification pointing at the feed, would come up empty.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type FeedWindowInput = {
  startAt: string | null | undefined;
  endAt: string | null | undefined;
  allDay: boolean;
};

/** The instant the feed stops listing this item, or null without a start. */
export function appFeedEndsAt(input: FeedWindowInput): Date | null {
  const start = input.startAt ? Date.parse(input.startAt) : Number.NaN;
  if (Number.isNaN(start)) return null;

  const end = input.endAt ? Date.parse(input.endAt) : Number.NaN;
  if (!Number.isNaN(end)) return new Date(end);

  return new Date(start + (input.allDay ? 2 : 1) * DAY_MS);
}

/** True once the feed no longer lists it — the SQL's `> p_now`, inverted. */
export function hasLeftAppFeed(input: FeedWindowInput, now: Date = new Date()): boolean {
  const endsAt = appFeedEndsAt(input);
  return endsAt !== null && endsAt.getTime() <= now.getTime();
}
