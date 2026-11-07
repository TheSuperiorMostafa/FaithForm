# RSVP System Reconciliation

## Problem

Migration 0147 introduced `group_event_responses` table with status values `pending/accepted/declined/tentative`, creating a parallel unused system conflicting with existing working `group_event_rsvps` table (migration 0091) using `going/maybe/not_going`.

Service `lib/groups/volunteer-scheduling.ts` referenced non-existent `group_memberships.user_id` column and was never wired to any API routes.

## Solution

**Removed from migration 0147:**
- `group_event_responses` table and all RLS policies (lines 126-243)
- Conflicting status enum system

**Removed from codebase:**
- `lib/groups/volunteer-scheduling.ts` (broken, unused)

**Kept from migration 0147:**
- `announcement_occurrences` table (recurring events - E4)
- `saved_event_locations` table (location suggestions)
- `notification_outbox` extensions for `group_announcement` (G2)

**Updated:**
- Migration hash in `scripts/verify-migration-baseline.mjs`: `3fc6f20311bad5f29d6d18c7a8c18a4b55ecb141078cae5ef861055bf036021f`

## Working Systems (Preserved)

### G1: Member Availability
- **Table:** `group_memberships.availability` (migration 0145)
- **API:** `/api/mobile/v1/groups/{slug}/{groupId}/availability`
- **Service:** `lib/groups/member-service.ts:memberAvailability()`
- **Storage:** `lib/groups/availability.ts:readOrSaveAvailability()`
- **RLS:** Migration 0148 (bypassed by service_role admin client)
- **Auth:** Application-level via `memberAccess()` verification

### B2: Event RSVP
- **Table:** `group_event_rsvps` (migration 0091)
- **API:** `/api/mobile/v1/groups/{slug}/{groupId}/events/{eventId}/rsvp`
- **Service:** `lib/groups/member-service.ts:rsvp()` → `lib/groups/gatherings.ts:setRsvp()`
- **Responses:** `going`, `maybe`, `not_going`
- **Auth:** Application-level via `memberAccess()` verification

## New Complete Features

### G2: Group Announcements
- **API:** `/api/mobile/v1/groups/{slug}/{groupId}/announcements` (POST)
- **Service:** `lib/groups/announcement-notifications.ts:queueGroupAnnouncement()`
- **Worker:** `lib/workers/process-notifications.ts:processGroupAnnouncement()`
- **Outbox:** `notification_outbox` kind=`group_announcement`, topic=`groups`
- **iOS:** `apps/faithform-ios/App/Groups/GroupAnnouncement.swift`
- **Android:** `apps/faithform-android/.../groups/GroupAnnouncement.kt`

### E4: Recurring Events (Complete)
- **Composer:** Recurrence fields in announcement composer (repeat, repeat_until)
- **Storage:** `announcements.is_recurring`, `recurrence_rule`, `recurrence_until`
- **Occurrences:** `announcement_occurrences` table with override support
- **Manager:** `components/announcements/occurrences-manager.tsx` with expand/collapse
- **Edit Modal:** `components/announcements/edit-occurrence-dialog.tsx` for per-occurrence overrides
- **Actions:** `app/dashboard/announcements/recurring-actions.ts` (list, cancel, edit)

## Files Changed

**Modified:**
- `supabase/migrations/0147_recurring_events_and_group_announcements.sql`
- `scripts/verify-migration-baseline.mjs`
- `lib/groups/announcement-notifications.ts`

**Removed:**
- `lib/groups/volunteer-scheduling.ts`

**Created:**
- `app/api/mobile/v1/groups/[slug]/[groupId]/announcements/route.ts`
- `apps/faithform-ios/App/Groups/GroupAnnouncement.swift`
- `apps/faithform-android/.../groups/GroupAnnouncement.kt`
- `components/announcements/edit-occurrence-dialog.tsx`

## Testing Required

1. Run migration baseline checker: `pnpm test` (should pass with new 0147 hash)
2. Typecheck: `NODE_OPTIONS="--max-old-space-size=4096" pnpm typecheck`
3. Behavioral tests needed:
   - G1: Member updates own availability
   - B2: Member RSVPs to event
   - G2: Leader sends group announcement
   - E4: Edit recurring occurrence

## Status

- ✅ Schema conflict resolved
- ✅ Dead code removed
- ✅ Migration hash updated
- ✅ G2 group announcements implemented
- ✅ E4 occurrence edit modal implemented
- ⏳ Behavioral tests pending
- ⏳ Independent correctness review pending
