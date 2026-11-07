# Remaining Checklist - JB Nov 6 Fixes

## Status Summary

**Security Review:** ✅ Complete
- Finding 1-6 all addressed
- Migrations 0146, 0148 hash-pinned as reviewedCorrections
- Independent review approved 0148 (ownership + active relationship + church-specific)
- Guardian service graceful return verified

**Test Status:** ✅ Passing (with documented limitations)
- 2213 tests passing
- 13 policy tests skip gracefully (require Supabase API)
- PostgreSQL v16 installed, full Supabase API unavailable in environment
- Runtime test limitations documented in `tests/policies/RUNTIME-STATUS.md`

**Typecheck:** ✅ Clean exit 0

## Remaining UI Wiring

### E4: Recurring Event Occurrences Management

**Backend:**
- ✅ `announcement_occurrences` table (migration 0147)
- ✅ `createRecurringOccurrences()`, `cancelOccurrence()`, `editOccurrence()` (lib)
- ✅ Server actions: `generateRecurringOccurrences`, `cancelRecurringOccurrence`, `editRecurringOccurrence`, `listAnnouncementOccurrences`
- ✅ `OccurrencesManager` component created

**Frontend (TODO):**
- [ ] Wire `OccurrencesManager` into announcement detail view
- [ ] Show occurrences list after recurring event is created
- [ ] Edit occurrence modal (override title/location/time)
- [ ] Member-facing occurrence view in announcements page

**Acceptance:**
- User can create recurring event (daily/weekly/monthly)
- Admin can view list of future/past occurrences
- Admin can cancel single occurrence with reason
- Admin can edit single occurrence (overrides)
- Cancelled occurrences show reason and status

### G1: Volunteer Availability Self-Service

**Backend:**
- ✅ `group_memberships.availability` column (migration 0145)
- ✅ RLS policy with active church relationship verification (migration 0148, independently reviewed)
- ✅ `updateMemberAvailability` server action

**Frontend:**
- ✅ `AvailabilityForm` component created

**TODO:**
- [ ] Wire AvailabilityForm into member group view (app path)
- [ ] Add availability tab/section to group member UI
- [ ] Show current availability status in member roster

**Acceptance:**
- Member can set availability (available/limited/unavailable)
- Member can add notes about availability
- Availability shows in leader's member roster
- Updates respect RLS (same church + active relationship)

### G2: Group Announcement Composer + Worker

**Backend:**
- ✅ `notification_outbox` with `group_announcement` kind (migration 0147)
- ✅ `processNotificationOutbox` worker supports `group_announcement`
- ✅ Strict constraint validation (migration 0149)

**Frontend (TODO):**
- [ ] Group announcement composer modal in group views
- [ ] Target selection (all members / specific role / custom list)
- [ ] Respect member notification preferences
- [ ] Send button triggers outbox worker (no live sends in tests)

**Acceptance:**
- Leader can compose announcement to group
- Announcement queued in notification_outbox
- Worker processes queue (test mode: no external sends)
- Members with app get notification (when live)

### B2: Volunteer Schedule Response UI

**Backend:**
- ✅ `group_event_responses` table (migration 0147)
- ✅ RLS policies for member responses with church verification
- ✅ Response statuses: pending, accepted, declined, tentative

**Frontend (TODO):**
- [ ] Schedule response card in member group view
- [ ] Accept / Decline / Tentative buttons
- [ ] Show assigned events requiring response
- [ ] Response note field (optional)

**Acceptance:**
- Member sees events they're assigned to
- Member can accept/decline/mark tentative
- Response saves with timestamp
- Leader sees response status in schedule view

### B3: Church App Settings Tabs (6 Sections)

**Backend:**
- ✅ All settings actions in `app/dashboard/app/actions.ts`
- ✅ Separate pages for each section

**Frontend:**
- ✅ `church-app-tabs.tsx` with 6 tabs
- ✅ `/dashboard/app/about/page.tsx` renders separately
- ✅ Tab navigation client-side

**TODO (Verification):**
- [ ] Verify all 6 tabs render functional content:
  - Look & name (logo, cover, name, tagline)
  - About (description, welcome message)
  - Service times (schedule list, add/edit/remove)
  - Location & contact (address, phone, email)
  - Social (social media links)
  - Links (quick links, website, app links)
- [ ] Each section saves independently
- [ ] No cross-section data corruption

**Acceptance:**
- Each tab shows dedicated settings section
- Forms pre-populate with current values
- Save button updates only that section
- Navigation preserves unsaved changes (confirm dialog)

### W1: Website Editor Large Preview + Compact Sidebar

**Backend:**
- ✅ No backend changes required

**Frontend:**
- ✅ `pages-workspace.tsx` dual-pane layout (`xl:grid-cols-[minmax(0,2fr)_380px]`)
- ✅ Compact sidebar: `size="sm"` buttons, tighter padding (`p-3/p-4`)
- ✅ Large preview canvas (600px/800px min-height, 2fr ratio)
- ✅ Test updated for aria-label pattern

**TODO (Visual QA):**
- [ ] Verify preview canvas is prominently large (2fr vs 380px sidebar)
- [ ] Verify sidebar controls are compact but readable
- [ ] Verify responsive layout (collapses to single column on small screens)
- [ ] Verify section drag-and-drop works with compact layout
- [ ] No visual regressions (buttons, spacing, alignment)

**Acceptance:**
- Preview is visually dominant (2/3 of screen width)
- Sidebar is compact but functional (380px fixed width)
- Layout responds to viewport (mobile: stacked, desktop: side-by-side)
- All editor functions work (add section, reorder, edit, save)

## Test Failures (Pre-existing, Unrelated to Security)

None currently blocking. Security review fixes resolved:
- ✅ Migration baseline test (0146, 0148 reviewedCorrections)
- ✅ Website simplicity test (aria-label pattern)

## Release Checklist

### Before Merge
- [ ] Complete E4/G1/G2/B2/B3/W1 UI wiring
- [ ] All tests green (or documented skip reasons)
- [ ] Typecheck clean
- [ ] Visual QA screenshots for W1/B3
- [ ] No production data in tests
- [ ] No live notifications sent from tests

### Post-Merge / Pre-Production
- [ ] Run integration tests in CI/CD with Docker Supabase
- [ ] Or provision temporary test Supabase project
- [ ] Execute security policy tests with full runtime
- [ ] Migration dry-run on staging database
- [ ] Verify existing notification_outbox rows satisfy new constraints
- [ ] Load test outbox worker with 0149 constraints

### Production Deployment
- Apply migrations in order:
  1. 0146 (stream-recordings bucket)
  2. 0147 (recurring events, group responses)
  3. 0148 (member self-service RLS)
  4. 0149 (notification strict validation)

## Time Estimate (Remaining Work)

**E4 Wiring:** ~30 min (wire component, test occurrence list)
**G1 Wiring:** ~20 min (wire form into member view)
**G2 Composer:** ~45 min (modal, target selection, queue trigger)
**B2 Response UI:** ~40 min (response card, buttons, save flow)
**B3 Verification:** ~15 min (manual testing each tab)
**W1 Visual QA:** ~10 min (screenshot, responsive check)

**Total Remaining:** ~2.5 hours of UI work

## Notes

- Security review complete, migrations approved
- Runtime tests documented as requiring full Supabase (not available in agent environment)
- SQL correctness verified, RLS policies independently reviewed
- Default-deny + explicit policies in place
- Test suite green except graceful skips
- No blockers for release once UI wiring complete
