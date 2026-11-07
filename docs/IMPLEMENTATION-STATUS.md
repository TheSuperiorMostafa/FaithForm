# Implementation Status Report

## Complete Features

### ✅ E4: Recurring Events (Dashboard Composer + Manager)
- **Composer:** Repeat fields (daily/weekly/monthly + until date) save to database
- **Storage:** `is_recurring`, `recurrence_rule`, `recurrence_until` columns populated
- **Occurrence Generation:** `createRecurringOccurrences()` called on publish (verified in actions.ts:596)
- **Manager UI:** `OccurrencesManager` displays upcoming/past occurrences with expand/collapse
- **Edit Modal:** `EditOccurrenceDialog` for per-occurrence overrides (title, description, location)
- **Cancellation:** Cancel individual occurrences with reason
- **Source:** 
  - `app/dashboard/announcements/actions.ts:593-606`
  - `components/announcements/occurrences-manager.tsx`
  - `components/announcements/edit-occurrence-dialog.tsx`
  - `lib/announcements/recurring-events.ts:createRecurringOccurrences()`

### ✅ G2: Group Announcements (Backend + Worker)
- **API:** `POST /api/mobile/v1/groups/{slug}/{groupId}/announcements`
- **Service:** `queueGroupAnnouncement()` filters active members, verifies relationships
- **Worker:** Real push notification dispatch via APNs/FCM adapters
- **Token Management:** Handles invalidation, retries, delivery tracking
- **Failure Handling:** Retry logic with exponential backoff (3 attempts)
- **Test Mode:** Skips actual send when providers not configured
- **Source:**
  - `app/api/mobile/v1/groups/[slug]/[groupId]/announcements/route.ts`
  - `lib/groups/announcement-notifications.ts:queueGroupAnnouncement()`
  - `lib/workers/process-notifications.ts:dispatchGroupAnnouncement()`

### ✅ G1: Member Availability (Existing)
- **API:** `GET/PUT /api/mobile/v1/groups/{slug}/{groupId}/availability`
- **Storage:** `group_memberships.availability` column (migration 0145)
- **Service:** `memberAvailability()` in member-service.ts
- **Auth:** Application-level via `memberAccess()` verification
- **Source:** iOS `GroupAvailability.swift`, Android `GroupAvailability.kt`

### ✅ B2: Event RSVP (Existing)
- **API:** `PUT /api/mobile/v1/groups/{slug}/{groupId}/events/{eventId}/rsvp`
- **Storage:** `group_event_rsvps` table (migration 0091)
- **Service:** `setRsvp()` in gatherings.ts
- **Responses:** `going`, `maybe`, `not_going`
- **Auth:** Application-level via `memberAccess()` verification
- **Source:** iOS `GroupEvents.swift`, Android `GroupEvents.kt`

### ✅ Schema Reconciliation
- **Removed:** `group_event_responses` table (conflicting parallel system)
- **Removed:** `lib/groups/volunteer-scheduling.ts` (broken, no callers)
- **Removed:** `app/dashboard/groups/volunteer-actions.ts` (imported deleted code)
- **Preserved:** `announcement_occurrences`, `saved_event_locations`, notification_outbox extensions
- **Migration 0147 Hash:** `3fc6f20311bad5f29d6d18c7a8c18a4b55ecb141078cae5ef861055bf036021f`

### ✅ Security Migrations
- **0146:** Stream recordings private bucket - hash unchanged
- **0148:** Member availability RLS - hash unchanged  
- **0149:** Notification outbox strict validation - hash unchanged

---

## Incomplete / Remaining Work

### ⚠️ G2: Mobile UI Integration (NOT REACHABLE)
**Problem:** iOS and Android announcement UI components exist but are NOT imported/rendered from group menus.

**Created but orphaned:**
- `apps/faithform-ios/App/Groups/GroupAnnouncement.swift`
- `apps/faithform-android/.../groups/GroupAnnouncement.kt`

**Required:**
1. Import `GroupAnnouncementView` into iOS group navigation
2. Import `GroupAnnouncementSheet` into Android group navigation
3. Add menu item or FAB button for "Send Announcement" (leaders only)
4. Wire up permission check (`canSendGroupAnnouncement`)

**Estimated effort:** 30-60 minutes per platform

---

### ⚠️ E4: Mobile Feed/Calendar Consumption (NOT IMPLEMENTED)
**Problem:** Occurrence generation works, but mobile feeds/calendar do not consume generated occurrences.

**Current state:**
- `announcement_occurrences` table populated on publish ✅
- Dashboard `OccurrencesManager` displays occurrences ✅
- Mobile feed uses `mobile_announcement_feed` RPC function ❌ (does not join occurrences)
- Mobile schedule uses `mobile_announcement_schedule` RPC function ❌ (does not join occurrences)
- Calendar exports do not include occurrences ❌

**Required:**
1. Update `mobile_announcement_feed` RPC to join `announcement_occurrences`
2. Update `mobile_announcement_schedule` RPC to join `announcement_occurrences`
3. Apply occurrence overrides (title, description, location)
4. Filter cancelled occurrences
5. Handle DST transitions correctly
6. Test with real recurring events across timezone changes

**Estimated effort:** 4-8 hours (SQL function updates + testing)

---

### ⚠️ Behavioral Integration Tests (NOT IMPLEMENTED)
**Problem:** No actual database-backed RLS/constraint tests for new features.

**Required:**
1. Local Postgres SET ROLE tests for:
   - G1: Member updates own availability (RLS bypass verified)
   - B2: Member RSVPs to event
   - G2: Leader queues announcement, non-leader blocked
   - E4: Occurrence generation with overrides/cancels
2. Constraint violation tests:
   - Notification outbox per-kind validation
   - Duplicate dedupe_key handling
3. DST transition tests for recurring events

**Current tests:** 2228 unit/security tests, 0 behavioral integration tests

**Estimated effort:** 2-4 hours

---

### ⚠️ W1: Website Editor Redesign (INCOMPLETE from spec)
**Status:** Not started. Spec ID W1 unimplemented.

---

### ⚠️ B3: Church App Settings Tabs (INCOMPLETE from spec)
**Status:** Not started. Spec ID B3 unimplemented.

---

### ⚠️ W2: [Unspecified in provided spec]
**Status:** Unknown requirements. Not referenced in task list.

---

## Test Results

```
# tests 2228
# pass 2215
# fail 0
# skip 13
```

**Typecheck:** Clean (exit 0)

**Note:** All passing tests are unit/security tests. No behavioral integration tests exist yet.

---

## Migration Status

**Unapplied Migrations:**
- 0146: Stream recordings bucket
- 0147: Recurring events + group announcements (reconciled)
- 0148: Member availability RLS
- 0149: Notification outbox validation

**Production:** NOT deployed. Awaiting independent review + migration plan.

---

## Summary

**Completed:**
- E4 recurring events (dashboard composer + manager + edit modal)
- G2 group announcements (backend API + worker with real push dispatch)
- Schema reconciliation (removed parallel RSVP system)
- G1/B2 existing systems verified and documented

**Critical Gaps:**
1. G2 mobile UI not reachable (components exist but not wired)
2. E4 occurrences not consumed by mobile feeds/calendar
3. No behavioral integration tests

**Blockers for Merge:**
- Mobile UI integration (G2)
- Feed/calendar occurrence consumption (E4)
- Behavioral tests
- Independent correctness review
- Production migration plan

**Branch:** `cursor/jb-nov6-fixes-ed1c`
**Commit:** [pending]
**PR:** [#13](https://github.com/TheSuperiorMostafa/FaithForm/pull/13)
