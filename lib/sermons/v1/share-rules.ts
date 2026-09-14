import { projectOutline } from "@/lib/sermons/v1/projection";

/**
 * The rules for sharing a sermon in the FaithForm app, as pure functions.
 *
 * Used by the server action that publishes and by the dashboard card that
 * explains why it cannot yet, so the reason a pastor reads is the reason the
 * server applies.
 */

export type SermonAudience = "public" | "followers" | "members";

/** What the builder calls a sermon nobody has named. */
const PLACEHOLDER_TITLES = new Set(["", "untitled sermon"]);

export type SermonShareReadiness =
  | { ready: true }
  | {
      ready: false;
      /** Short, for a heading: what to do next. */
      title: string;
      /** One sentence on what the app needs. */
      message: string;
    };

export const SHARE_NOT_READY_TITLE = "Create the lesson first";

/** Where on the sermon page the share card and the lesson panel live. */
export const SHARE_IN_APP_ANCHOR = "share-in-app";
export const LESSON_ANCHOR = "lesson";

/** Said on the card and by the server, so a non-admin never meets a surprise. */
export const ONLY_ADMINS_CAN_SHARE =
  "Only church admins can share sermons in the FaithForm app.";

/**
 * Whether the app would show a member anything worth opening.
 *
 * A content rule rather than the builder's draft/published status: every new
 * sermon starts as a draft and nothing in today's builder finishes it, so a
 * status rule made sharing impossible. What actually matters is what the app
 * renders — an outline, or at the very least a real title and the passage it
 * was preached from.
 */
export function sermonShareReadiness(sermon: {
  title?: string | null;
  scripture_refs?: readonly string[] | null;
  outline?: unknown;
}): SermonShareReadiness {
  if (projectOutline(sermon.outline)) return { ready: true };

  const title = (sermon.title ?? "").trim();
  const hasTitle = !PLACEHOLDER_TITLES.has(title.toLowerCase());
  const hasScripture = (sermon.scripture_refs ?? []).some(
    (reference) => typeof reference === "string" && reference.trim().length > 0,
  );
  if (hasTitle && hasScripture) return { ready: true };

  return {
    ready: false,
    title: SHARE_NOT_READY_TITLE,
    message:
      "Members see the outline and discussion questions, so create the lesson " +
      "before sharing — or give the sermon a title and at least one scripture passage.",
  };
}

/** Shared right now, as the mobile projections decide it. */
export function isSermonShared(sermon: {
  mobile_visibility?: string | null;
  mobile_published_at?: string | null;
  mobile_unpublished_at?: string | null;
}): boolean {
  return (
    (sermon.mobile_visibility ?? "none") !== "none" &&
    Boolean(sermon.mobile_published_at) &&
    !sermon.mobile_unpublished_at
  );
}

/**
 * Who can read a shared sermon, in words that are true of the apps.
 *
 * Both apps only open a church's sermon notes for a signed-in account that
 * follows or has joined that church, so "public" reaches exactly the same
 * people as "followers" there. Calling it "Anyone" promised a reach it does not
 * have; both read as followers.
 */
export function sermonAudienceLabel(
  visibility: string | null | undefined,
  form: "long" | "short" = "long",
): string | null {
  switch (visibility) {
    case "public":
    case "followers":
      return form === "long" ? "Anyone who follows your church" : "Followers";
    case "members":
      return "Members only";
    default:
      return null;
  }
}
