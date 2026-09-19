import type {
  AnnouncementRow,
  MobileVisibility,
} from "@/lib/queries/announcements";

/**
 * Where a published announcement actually went, read from what was saved.
 *
 * The switches a publish asked for are not the answer: a Facebook post that
 * failed still has `push_to_facebook` set, so Facebook counts only once there
 * is a post. Safe to import in the browser.
 */
export type PublishedChannels = {
  app: { published: boolean; visibility: MobileVisibility };
  facebook:
    | { published: false }
    | { published: true; scheduledFor: string | null; url: string };
  weeklyEmail: { published: boolean };
};

export function publishedChannels(
  announcement: AnnouncementRow,
  options: { queuedForWeeklyEmail?: boolean; now?: number } = {},
): PublishedChannels {
  const visibility = announcement.mobile_visibility ?? "none";
  const postId = announcement.facebook_post_id;
  const scheduled = announcement.facebook_scheduled_publish_time ?? null;
  const now = options.now ?? Date.now();

  return {
    app: { published: visibility !== "none", visibility },
    facebook: postId
      ? {
          published: true,
          // A scheduled post whose time has passed is already public.
          scheduledFor: scheduled && Date.parse(scheduled) > now ? scheduled : null,
          url: facebookPostUrl(postId),
        }
      : { published: false },
    weeklyEmail: {
      published: announcement.push_to_team || Boolean(options.queuedForWeeklyEmail),
    },
  };
}

/** Whether there is anywhere left to publish it. */
export function hasUnpublishedChannel(channels: PublishedChannels): boolean {
  return (
    !channels.app.published ||
    !channels.facebook.published ||
    !channels.weeklyEmail.published
  );
}

export function describeAppAudience(visibility: MobileVisibility): string {
  switch (visibility) {
    case "public":
      return "Everyone in the app";
    case "followers":
      return "Anyone who has added your church";
    case "members":
      return "Members only";
    case "none":
      return "Not shared in the app";
  }
}

export function facebookPostUrl(postId: string): string {
  return `https://www.facebook.com/${postId.replace("_", "/posts/")}`;
}
