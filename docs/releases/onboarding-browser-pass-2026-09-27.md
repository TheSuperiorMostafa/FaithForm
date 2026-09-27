# Production browser onboarding pass — 2026-09-27

Scope: live `faithform.io`, using platform-admin switch into a newly created,
clearly labeled QA tenant. No code was pushed or deployed. All people, family,
room, and announcement data used here are synthetic. No real phone number,
payment method, or church member was used. Credentials, invite tokens, and
pickup codes are intentionally absent from this report.

QA church: `FaithForm Onboarding QA` (`d1d65673-2d45-4825-9e6e-c2d85d4583fd`).
Pre-existing `Faithform Church` was inspected read-only as a reference.

## Verified through browser clicks

- Platform admin login and church list loaded. The existing Faithform test
  church appeared with its profile, 13 enabled features, users, website,
  integration, and giving tabs.
- New-church form rejected an empty required name. Creating the QA church with
  Eastern time and the “set it up ourselves first” path succeeded. The church
  appeared with zero usage, no staff admin, and a first-admin invitation form.
- The first-admin form rejected an empty required first name. After explicit
  approval, an invite to the owner's dedicated Gmail alias showed as pending
  in Admin with a seven-day expiry. The email arrived in Gmail, its setup
  link opened the correct QA church, and Step 1 advanced to Step 2 of the
  six-step wizard. The address and names were prefilled correctly. The owner
  entered the password at Step 2. A second Supabase confirmation email then
  arrived, and its link advanced to Step 3. The profile form saved a synthetic
  address, state, ZIP, website, and reserved 555 phone number. Google and
  Facebook were skipped. Step 6 completed and “Go to FaithForm” opened the
  QA church dashboard under its own admin session, without impersonation.
- Platform-admin handoff opened the new church dashboard and displayed the
  correct active-tenant warning and name.
- People: empty-state, required first-name validation, two member creations,
  optional email save, and care-note save succeeded. The dummy email is on an
  `.invalid` domain. No phone was entered. A later search for the QA child
  returned only that member; combining it with “On the app” returned an empty
  result, and “Show everyone” cleared both search and filter.
- Family: created a synthetic household with a guardian, linked a second
  synthetic member as its child, and verified both role labels.
- Kids Check-in: required room-name validation, room creation with capacity
  and location, child lookup, room assignment, check-in, and room count
  succeeded. A wrong pickup code was rejected. The correct code found the
  household and required choosing a guardian; pickup completed and the weekly
  room report showed one check-in and no code-less release.
- Attendance: the child’s check-in was pre-counted on the Sunday roll. Saving
  one present and one absent synthetic person required a confirmation and
  preserved the entered note. The follow-up page showed the absent member but
  correctly disabled texting because this tenant has no texting connection or
  phone number.
- Announcements: event mode exposed day, time and place fields. The displayed
  date was initially a placeholder; picture generation correctly required
  entering a real date. After entering it, graphic generation completed.
  Posting the clearly labeled QA event to the new church's app succeeded and
  it appeared under Posted and scheduled. Email and Facebook destinations were
  disabled because those integrations are not connected.
- Editing that QA announcement updated it in the app. Taking it down removed
  it from Posted and scheduled. The page said it could be posted again, but
  the Taken down list did not appear after a full browser reload.
- Groups: created a private class group with description, size, meeting place,
  dummy online link, one member, and one leader. The members page preserved the
  leader role. Planned a synthetic meeting for September 28 with title, start
  and end times, place, URL, and notes; it appeared under Coming up. Safari's
  date-time control required explicitly entering PM after the visible time was
  filled, which the native validation caught.
- Group Reports showed the QA group and its single member with no attendance
  yet. Safety had no reports. Group settings showed messaging controls and the
  default group kinds. The messages overview listed the QA group; opening its
  chat showed the expected platform-admin restriction described below.
- As the QA church's real admin, group chat opened. A clearly labeled QA
  message sent successfully and remained visible after a full browser reload.
- The real admin also reopened People (both synthetic members), Kids Check-in
  (QA Nursery), Sermons (published QA sermon), and the draft Website. The
  taken-down announcement still had no recovery list in the live app.
- Reopening the planned meeting preserved its title, start/end times, place,
  URL, and notes. Saving the unchanged meeting again closed the editor and
  showed “QA Test Meeting updated.” The earlier discard prompt did not recur.
- Sermons: selected John 3:16–17, previewed ESV slides in Ivory Classic,
  saved a draft, presented both slides, generated a lesson with discussion
  questions, downloaded the 9 KB PDF and 52 KB PowerPoint, and published the
  explicitly labeled synthetic sermon to this QA tenant's app.
- Church App: edited tagline and About text, added a synthetic Sunday service,
  and used Save & publish. The profile and service persisted across a browser
  reload and appeared in the live phone preview. The search listing stayed off.
- Giving: setup showed the church identity and optional EIN/address step;
  Skip for now reached the Stripe bank-connection step. No bank account,
  actual EIN, or payment details were used.
- Website: built a Classic draft and verified a seven-section preview. An empty
  visit-form submission failed required-name validation. A synthetic inquiry
  submitted successfully and appeared in Inbox; marking it read and archiving
  it both worked. Email forwarding reported unavailable because this QA
  church has no contact email. A banner headline edit auto-saved and appeared
  in desktop and phone previews; the phone menu opened.
- Live: one-off service scheduling for September 28 succeeded, and cancellation
  removed it from Upcoming while preserving a Cancelled record. The empty
  Recordings view and streaming setup instructions loaded. No actual video
  stream was started.
- A second one-off QA service for September 30 saved its name, time,
  countdown, and live-chat choices. The published QA sermon's slides linked to
  it, stayed linked after reload, and could be removed again. Cancelling the
  service cleared Upcoming and kept a Cancelled record. YouTube and Facebook
  stayed disconnected; no video was uploaded or broadcast. In Safari's native
  date-time control, the date looked complete but submission returned
  “Invalid value” until month and year segments were explicitly entered.
  Code review found that the scheduling form treated the entered start time as
  the staff member's computer time, which could shift a service for remote
  staff. The local fix now interprets it in the church's time zone and rejects
  nonexistent daylight-saving times; the server requires an explicit UTC time.
  This correction passed focused tests and type checking but is not deployed.
- Settings: the new tenant's Team view was empty and showed admin, staff,
  volunteer, and custom permission choices. Connected accounts correctly
  showed Google, iCloud, YouTube, and Facebook as disconnected. Switching the
  member-app palette to Forest and wheat persisted. The Phone Calls empty
  state loaded.
- Group settings: changed the QA group's About text, saved, reloaded to verify
  persistence, then restored and saved the original description. Both saves
  showed “All changes saved” and the final value matched the original.
- Connected accounts: the iCloud Calendar link form opened with iPhone, Mac,
  and iCloud.com instructions. A deliberately invalid synthetic link was
  rejected with a clear iCloud-specific message. The alternate Apple ID form
  correctly explained the separate app-specific password; no credentials were
  entered and no calendar connected.
- Messages & email: the weekly subject rejected a value without `[Week]` with
  the expected validation error. A valid QA subject saved and persisted after
  reload; the standard wording was then restored and verified after reload.
  The five follow-up text templates displayed their default wording and live
  name previews. No email or text was sent.

## Issues found

- Group chat shows a retryable “This chat didn’t open” error in the platform
  admin church-switch session. The server intentionally denies chat tokens to
  impersonating platform staff. The UI should explain this restriction instead
  of implying a transient outage. On a later QA browser visit, the same group
  chat opened and displayed the earlier QA test message; this does not explain
  the initial error or establish the active account's permissions. Chat still
  needs a controlled real church-admin account test.
- After the group meeting saved and appeared in Coming up, a “Discard changes?”
  prompt surfaced. Choosing “Keep editing” left the saved meeting visible.
  The shared Groups dialog now ignores a native close notification that
  arrives after a successful controlled close. This local fix still needs
  browser verification after rollout.
- Code review found that new group meetings used the staff member's computer
  time zone even though they are church events, and an incomplete date could
  throw while converting to UTC. The local form now uses church time for new
  meetings, preserves an existing meeting's saved time zone when editing,
  and rejects nonexistent or incomplete local times. A separate local guard
  checks attendance history before changing its check-in window and reports
  failed or zero-row updates instead of silently saying the meeting saved.
  These fixes passed focused tests but still need a browser check after rollout.
  Event and attendance-window writes remain separate database operations;
  their atomicity needs a transaction before a full reliability claim.
- The QA meeting's attendance form loaded the QA member and accepted a local
  selection and note, but saving before the meeting's one-day attendance
  window returned “Attendance opens the day before the gathering.” Nothing
  was saved; the unsaved-change prompt discarded the trial input correctly.
  Attendance recording itself remains unverified.
- The production Church App cannot save quick links because the active
  `churches` table lacks `app_links` (Postgres 42703). The UI says links are
  unavailable. Save & publish still saves other profile fields but leaves the
  editor marked “Unsaved changes” and triggers a browser leave warning. A
  reload proved the tagline, About text, and service did persist. Local
  migration `0113_active_schema_catchup.sql` adds the missing column; it is
  not deployed.
- Entering a sermon passage's ending verse digit by digit caused the field
  to clamp between keystrokes (typing 17 became 36). Pasting `17` worked.
- The generated lesson's supporting-reference prose was awkward and included
  incomplete sentences. It should be reviewed by a human before publication.
- The missing Taken down list is a confirmed schema-fallback bug. The local
  schema extraction from this morning's production backup has
  `announcements.unsubmitted_at` but lacks
  `announcements.facebook_scheduled_publish_time`. The takedown action's old
  fallback removed all three optional fields when only the Facebook column
  was missing. The QA row therefore became pending without a takedown
  timestamp, so the recovery list omitted it. A second fresh QA item, this
  time with no event date, posted and edited successfully, then reproduced
  the same missing recovery list after takedown and browser reload. Local code
  now retries after dropping only the particular missing optional column,
  requires the takedown timestamp, checks that a row actually changed, and
  changes the canonical row before withdrawing its app projection. The repair
  is not deployed; any already affected pending rows need a separate,
  careful recovery plan. Do not backfill a timestamp for every pending draft:
  some were never posted.
- The two-email first-admin setup is a confirmed onboarding friction point:
  FaithForm's own invite already reaches the target mailbox, then ordinary
  Supabase sign-up sends a second confirmation. Local code now creates a
  confirmed Auth user through the trusted admin API only after validating the
  emailed church invite and exact address, then signs the user in. Public
  sign-up verification remains enabled. This change is not deployed and needs
  a fresh one-email browser rehearsal. The intended church setup is **one
  emailed link**, followed by password creation and sign-in without another
  email prompt. This does not change Google OAuth consent or Google's separate
  verification of FaithForm's Google integration. Supabase documents a native
  [single-invite flow](https://supabase.com/docs/guides/auth/users#inviting-users)
  as a possible later simplification; its invite link confirms the address and
  opens account setup. OWASP recommends
  [single-use, time-limited verification tokens](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html#email-ownership-verification).
  FaithForm's custom token is random and expires after seven days, but stays
  usable through all six setup steps and is only closed at completion. Before
  broad onboarding, rehearse retries, expired links, forwarded links, and
  concurrent account setup, then retire or exchange the token as soon as the
  verified account has an authenticated session without stranding a partially
  onboarded church.
- The live Step 6 handler wrote the invite acceptance and church completion
  before the admin membership and ignored errors on those first two writes.
  A membership failure could leave a completed church with no admin and an
  unusable invite. Local code now creates the membership first, checks each
  write, and accepts the invite last so a failed setup can be retried. This
  needs deployment and a fault-injection rehearsal.
- After roughly 30 minutes, the platform-admin church-switch note expired
  during client-side navigation. The QA banner remained visible while a new
  Groups page loaded the admin's own `Faithform Church` and its existing
  `Thursday people` group. A full browser reload changed the header to that
  church, and reentering the QA church showed only `QA Test Group`. No QA data
  was found in the other church; the dangerous failure is a stale banner over
  the wrong church context, which could misdirect a later write. Local changes
  keep the expired note as a deny-only marker, stop dashboard and API requests
  at middleware, and return the browser to Admin at expiry. These changes are
  not deployed; the live behavior remains a release blocker until verified.
- Typing a two-digit ending verse after a later starting verse is fixed
  locally by allowing the temporary partial number while keeping the draft
  invalid until the range is complete. This is not deployed.
- The Live service picker under “Show sermon slides during a service” kept its
  old choices immediately after a service was scheduled or cancelled; a full
  reload corrected it. The linker fetched its choices only on mount while
  scheduling refreshed the server page without remounting that client
  component. The local page now keys the linker to service IDs and statuses so
  a refreshed service list remounts it. This is not deployed or browser
  retested against the local build.

## Still in progress

- A fresh browser rehearsal of the one-email local fix and failure paths,
  plus optional provider connections, actual live video, payment processing,
  and mobile push.
- Other media, group chat as church staff, actual live video and recording,
  payment/bank onboarding, external integrations,
  first-admin permissions, other settings, and provider paths.
- Repeat checks for regressions and cleanup decision for the QA tenant.

This pass exercises a live QA tenant. It does not certify the local migrations
as deployed or measure hosted load at 100 churches.

## Local verification after these findings

The local changes passed TypeScript checking, targeted ESLint, 17 focused
announcement tests including older-schema fallback cases, all 441 security
tests including the one-email invite and retryable finalization checks, and an
optimized production build. The build emitted existing lint warnings outside
the edited files. No code was pushed or deployed.
The later Live picker refresh change passed TypeScript checking and targeted
ESLint; it still needs a browser check after rollout.
After the service-time, Groups dialog, and meeting-edit changes, the full local
suite passed all 1,772 tests, including the localhost-only streaming auth test. The
expired-switch middleware now uses the shared route gate, and its security
check passed. TypeScript checking, targeted lint, and the optimized production
build passed again; the build still reports existing lint warnings outside
these edits. No code was pushed or deployed.
