/**
 * The Groups vocabulary, shared by the dashboard, the mobile contract and the
 * services. Every list here mirrors a check constraint in migration 0091; a
 * value added in one place and not the other fails the policy tests.
 */

export const GROUP_STATUSES = ["active", "archived", "deleted"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export const GROUP_VISIBILITIES = ["public", "unlisted", "private"] as const;
export type GroupVisibility = (typeof GROUP_VISIBILITIES)[number];

export const GROUP_ENROLLMENTS = ["open", "approval_required", "invitation_only", "closed"] as const;
export type GroupEnrollment = (typeof GROUP_ENROLLMENTS)[number];

export const GROUP_ROLES = ["member", "leader", "manager"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const MEMBER_NOTIFICATION_LEVELS = ["default", "all", "mentions", "muted"] as const;
export type MemberNotificationLevel = (typeof MEMBER_NOTIFICATION_LEVELS)[number];

export const CHURCH_NOTIFICATION_LEVELS = ["all", "mentions", "off"] as const;
export type ChurchNotificationLevel = (typeof CHURCH_NOTIFICATION_LEVELS)[number];

export const SCHEDULE_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const GROUP_TYPE_ICONS = [
  "users", "book", "sparkles", "user", "heart", "graduation", "hands", "music",
  "briefcase", "school", "prayer", "church", "star", "coffee", "baby", "globe",
  "compass", "leaf",
] as const;
export type GroupTypeIcon = (typeof GROUP_TYPE_ICONS)[number];

export const RSVP_RESPONSES = ["going", "maybe", "not_going"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

/** What the caller's relationship to a group is, as a client renders it. */
export const MEMBERSHIP_STATES = [
  "member",
  "requested",
  "invited",
  "not_member",
  "banned",
] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

/**
 * The single action a group page offers someone who is not in it, decided
 * server-side so a client never has to reproduce the enrollment rules.
 */
export const JOIN_ACTIONS = [
  "join",
  "request",
  "cancel_request",
  "leave",
  "invitation_required",
  "full",
  "closed",
  "unavailable",
] as const;
export type JoinAction = (typeof JOIN_ACTIONS)[number];

export type ScheduleInput = {
  frequency: ScheduleFrequency;
  /** 0 = Sunday. */
  dayOfWeek: number;
  /** Monthly only: 1–4, or -1 for the last. */
  weekOfMonth: number | null;
  /** 24-hour HH:MM, local to `timezone`. */
  startTime: string;
  durationMinutes: number;
  timezone: string;
  /** YYYY-MM-DD. */
  startsOn: string;
  endsOn: string | null;
};
