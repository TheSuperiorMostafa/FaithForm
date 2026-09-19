/**
 * What deleting an account does to every table that points at it.
 *
 * Shared by two tests on purpose. `account-deletion-migration.test.ts` proves
 * this is exactly what the migrations declare; `account-deletion.test.ts`
 * builds its fake database's foreign keys from it. So the unit test's cascade
 * cannot drift from the real schema without the policy test failing first.
 *
 * Not a `.test.ts` file, so the test globs never run it on its own.
 */

export type ForeignKeyAction = "cascade" | "set null";

export type Reference = {
  table: string;
  column: string;
  action: ForeignKeyAction;
};

/**
 * The account's own data. Gone with the account, because /account-deletion
 * lists each of these under "What gets deleted".
 */
export const ACCOUNT_OWNED: readonly Reference[] = [
  { table: "visitor_church_relationships", column: "account_id", action: "cascade" },
  { table: "visitor_relationship_events", column: "account_id", action: "cascade" },
  { table: "visitor_people_claims", column: "account_id", action: "cascade" },
  { table: "visitor_people_links", column: "account_id", action: "cascade" },
  { table: "visitor_device_installations", column: "account_id", action: "cascade" },
  { table: "visitor_notification_preferences", column: "account_id", action: "cascade" },
  { table: "attendance_detections", column: "account_id", action: "cascade" },
  { table: "attendance_qr_scan_redemptions", column: "account_id", action: "cascade" },
  { table: "giving_donor_links", column: "account_id", action: "cascade" },
  { table: "giving_donation_attempts", column: "account_id", action: "cascade" },
  // Groups (0091/0092). A membership or ban anchored to a People record is the
  // church's and survives: a before-delete trigger on visitor_accounts nulls
  // the account on those rows first, so the cascade below only removes what
  // belonged to the app account alone — its own joins, requests and RSVPs.
  { table: "group_memberships", column: "account_id", action: "cascade" },
  { table: "group_join_requests", column: "account_id", action: "cascade" },
  { table: "group_bans", column: "account_id", action: "cascade" },
  { table: "group_event_rsvps", column: "account_id", action: "cascade" },
  { table: "messaging_notification_preferences", column: "account_id", action: "cascade" },
];

/**
 * Records that outlive the account with the link to it removed: a church's
 * attendance, check-in and People audit, and the record that deletion was
 * requested (migration 0073).
 */
export const KEPT_UNLINKED: readonly Reference[] = [
  { table: "visitor_invitations", column: "accepted_by_account_id", action: "set null" },
  { table: "visitor_people_link_events", column: "account_id", action: "set null" },
  { table: "visitor_account_requests", column: "account_id", action: "set null" },
  { table: "attendance_attempts", column: "account_id", action: "set null" },
  { table: "attendance_qr_redemptions", column: "account_id", action: "set null" },
  { table: "checkin_sessions", column: "pre_checked_in_by_account_id", action: "set null" },
  // A group's audit keeps the event, not the person.
  { table: "group_audit_events", column: "subject_account_id", action: "set null" },
];

export const ACCOUNT_REFERENCES: readonly Reference[] = [...ACCOUNT_OWNED, ...KEPT_UNLINKED];

/**
 * Everything that is *removed* when a Supabase Auth user is deleted. The first
 * is the deletion itself. The rest are dashboard access and church records,
 * which is why account-deletion.ts keeps the Auth user of anyone with a row in
 * one of them.
 */
export const AUTH_USER_CASCADES: readonly Reference[] = [
  { table: "visitor_accounts", column: "user_id", action: "cascade" },
  { table: "church_users", column: "user_id", action: "cascade" },
  { table: "platform_admins", column: "user_id", action: "cascade" },
  { table: "sermons", column: "created_by", action: "cascade" },
  { table: "dashboard_usage_daily", column: "user_id", action: "cascade" },
];

/**
 * The person's own messaging data, keyed by sign-in because staff chat from
 * the dashboard as well as members from the app. Removed *with* the Auth user,
 * and deliberately **not** sign-in dependents: holding a chat identity, a
 * block or a conversation must never be the reason an account deletion keeps
 * someone's email address. Deleting the binding enqueues the provider-side
 * deletion (0092 `messaging_before_binding_delete`), so the chat provider
 * forgets them too.
 */
export const AUTH_USER_OWNED: readonly Reference[] = [
  { table: "messaging_user_bindings", column: "user_id", action: "cascade" },
  { table: "messaging_dm_channels", column: "user_low", action: "cascade" },
  { table: "messaging_dm_channels", column: "user_high", action: "cascade" },
  { table: "messaging_blocks", column: "blocker_user_id", action: "cascade" },
  { table: "messaging_blocks", column: "blocked_user_id", action: "cascade" },
  { table: "messaging_restrictions", column: "user_id", action: "cascade" },
  { table: "group_staff_reads", column: "user_id", action: "cascade" },
];
