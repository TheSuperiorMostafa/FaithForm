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
- Closing QA Nursery marked it Closed and removed it from the Check-in desk;
  reopening it restored the room and left its history intact. While all rooms
  were closed, the live desk misleadingly said “No rooms yet” and offered “Add
  rooms.” The local desk now says “All rooms are closed” and directs an admin
  to manage and reopen one. The QA room was reopened before this pass ended.
- The Check-in desk's New family form rejected a blank parent name. After
  entering a synthetic parent and two synthetic children, Save and check in
  created the family in People, showed both children in QA Nursery, and issued
  the family's weekly pickup code. The code is intentionally absent here.
  Searching by family name in Pick up found both children. The no-code path
  required choosing a pickup person and a written reason; releasing the two
  synthetic children succeeded. Reports then showed three check-ins for the
  week and two no-code releases, each with the QA admin, room, guardian, time,
  and explicit synthetic-test reason. This tested the currently deployed
  checkout path; Rooms returned to zero checked in after pickup. The local atomic two-child fix in migration 0116 still needs
  a browser retest after rollout. Local migration 0117 also makes the New family
  People and family writes one transaction; this live test used the older flow,
  so the transaction needs its own browser retest after rollout.
- Attendance: the child’s check-in was pre-counted on the Sunday roll. Saving
  one present and one absent synthetic person required a confirmation and
  preserved the entered note. The follow-up page showed the absent member but
  correctly disabled texting because this tenant has no texting connection or
  phone number.
- Attendance display and welcome desk: enabled Scan a code only for the QA
  church, generated a one-use display pairing code, paired a separate Safari
  tab, and saw its rotating check-in code. Turning the display off returned
  that tab to pairing. The Scan a code setting was restored to off and stayed
  off after reload. Then enabled the QA welcome desk, paired its kiosk tab,
  searched for the synthetic QA member, and verified that trying to check in
  before the service window returned “Check-in isn't open yet.” Lock returned
  the kiosk to pairing. The station was revoked, and Welcome desk was restored
  to off and verified after reload. No attendance record was added.
- Announcements: event mode exposed day, time and place fields. The displayed
  date was initially a placeholder; picture generation correctly required
  entering a real date. After entering it, graphic generation completed.
  Posting the clearly labeled QA event to the new church's app succeeded and
  it appeared under Posted and scheduled. Email and Facebook destinations were
  disabled because those integrations are not connected.
- Editing that QA announcement updated it in the app. Taking it down removed
  it from Posted and scheduled. The page said it could be posted again, but
  the Taken down list did not appear after a full browser reload. A read-only
  QA-row check found that the deployed version saved both previously posted
  announcements as pending without a take-down timestamp. The local list now
  also recognizes rows with a prior publisher and uses their last update time;
  a read-only run of that local reader returned both QA announcements.
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
- Sermon series: the blank title was rejected. A clearly labeled two-week QA
  series generated and persisted its week plans, themes, and passages. Starting
  Week 1 prefilled its title and John 3:16–17; the new sermon saved as a draft.
  A read-only QA database check confirmed the draft's series link. On reopening
  the series, Week 1 still said “Start this week's sermon” and gave no link to
  that saved draft. The local series view now shows linked sermons and opens
  the saved draft; new sermons store their exact planned week. This needs a
  browser retest after the local migration and application are rolled out.
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
  Recordings view and streaming setup instructions loaded.
- Live setup: clicked through OBS Studio, ATEM Mini, vMix, this computer, and
  the volunteer/company instructions. Device choice survived a reload. The
  recording audience changed to followers and back to Everyone, and both
  saves survived a reload. Automatic publication toggled on and back to
  "Let me review first"; the original review choice survived a reload. The
  QA church ended with its original computer source, Everyone audience,
  website publication on, no default series, and both notifications off.
  Recordings' Published and Series filters showed appropriate empty states.
  Upcoming showed the two cancelled QA services and disabled slide linking
  while no service is scheduled. The later live cycle is described below.
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
- Live video and recording: with explicit owner approval, Safari was granted
  camera and microphone access for the QA church. Starting the studio before
  the first Go live failed with a streaming-service configuration error. After
  choosing the OBS setup path and pressing Go live, a clearly titled QA
  service entered Waiting for video. Starting the browser studio then connected
  the same camera; Live showed recording in progress. End service saved a
  48-second recording, which became reviewable and played a real camera frame
  in Safari. The recording remains unpublished. The browser's capture indicator
  remained active on the ended-service screen and cleared when navigating to
  Recordings. The original computer source and manual-review publication
  choice were restored and verified after reload; YouTube and Facebook were
  never connected.
- Recording review: searching for an unrelated title returned a helpful empty
  state, while searching for `QA ONLY` found the unpublished recording. Its
  review page played the saved video and showed title, series, audience,
  website/app destinations, speaker, description, scripture, topics, artwork,
  and trim controls. Saving a trim changed the displayed duration, and restoring
  the full span returned it to 0:48. The Go live page offered a review reminder;
  Prepare the next service exposed the next-service controls, and Later folded
  the reminder into a smaller link. Neither action published the recording.
- Settings: the new tenant's Team view was empty and showed admin, staff,
  volunteer, and custom permission choices. Connected accounts correctly
  showed Google, iCloud, YouTube, and Facebook as disconnected. Switching the
  member-app palette to Forest and wheat persisted. The Phone Calls empty
  state loaded.
- Team and app settings follow-up: the live team now lists the QA admin. The
  invitation form rejected both a blank address and `not-an-email` before
  submission. Volunteer was the default preset, and expanding custom tools
  showed the expected individual permissions. The form was canceled; no
  invitation was sent. In Member App settings, switching from Forest and wheat
  to Navy and gold saved, then restoring Forest and wheat survived a full
  reload. The custom-color controls opened without applying a new palette.
- Church App follow-up: switching the live preview between Your people and
  Someone new changed the final action from Change/Remove church to Add church,
  then returned to the member view. Search listing stayed off, no campus or
  invitation link was created, and the Phone Calls page still showed its
  expected empty state.
- Church details: the QA contact-email field rejected malformed text in the
  browser without saving it. A synthetic `.invalid` address saved and survived
  a full reload; clearing and saving it again restored the original empty
  value, also verified after reload. A blank added service time was omitted on
  save as the UI promised. A named Wednesday QA service time saved and survived
  a reload, then was removed; another reload showed only the original Sunday
  service. No email was sent.
- Website enquiry delivery: temporarily set the QA church contact address to
  the owner's authorized Gmail alias, then submitted a clearly labeled
  synthetic visitor enquiry through the draft website preview. The form showed
  success, the message appeared under New in the church Website Inbox, and
  Gmail received the matching FaithForm email with the visitor name, dummy
  sender address, and message. The contact address was cleared again and a
  full browser reload confirmed the original empty value. The synthetic
  enquiry was archived and verified in the Archived list. No reply was sent.
- Group settings: changed the QA group's About text, saved, reloaded to verify
  persistence, then restored and saved the original description. Both saves
  showed “All changes saved” and the final value matched the original.
- Recurring meetings: the required first-date field rejected an empty value.
  A Tuesday 6:30 PM schedule bounded to October created four meetings on the
  expected Tuesdays in the QA church. Stopping the schedule removed all four
  generated upcoming meetings and showed a success message. After the save,
  the live app also showed the stale “Discard changes?” prompt; choosing
  “Keep editing” revealed that the schedule had saved correctly. The local
  shared-dialog fix still needs a browser retest after rollout.
- Group attendance: created a separate, clearly labeled QA meeting inside its
  attendance window. Saved one synthetic member and one guest, then reopened
  the form to verify both counts and the note. Corrected the guest and
  first-time guest counts to zero; the meeting summary showed one attendee and
  zero guests after a full browser reload. Entering one first-time guest with
  zero total guests was rejected with a clear validation message and the
  invalid entry was discarded. The live app displayed the same stale
  “Discard changes?” prompt after each successful save.
- Connected accounts: the iCloud Calendar link form opened with iPhone, Mac,
  and iCloud.com instructions. A deliberately invalid synthetic link was
  rejected with a clear iCloud-specific message. The alternate Apple ID form
  correctly explained the separate app-specific password; no credentials were
  entered and no calendar connected.
- Code review of the Google/Facebook onboarding return found that a failed
  connection-status database read was displayed as “disconnected.” The local
  flow now reports that the status could not be checked, so an admin can
  reload the step before deciding whether to connect again. This failure path
  still needs a controlled browser rehearsal after rollout.
- Messages & email: the weekly subject rejected a value without `[Week]` with
  the expected validation error. A valid QA subject saved and persisted after
  reload; the standard wording was then restored and verified after reload.
  The five follow-up text templates displayed their default wording and live
  name previews. No email or text was sent.
- Follow-up templates: changed the QA church's first-absence text to a clearly
  labeled test sentence. The live name preview changed immediately, the save
  succeeded, and the value survived a full browser reload. Restoring the
  original sentence and reloading again returned both the field and preview
  to their initial wording. No text was sent. The Monday announcement email
  is a Gmail draft feature; this tenant's Google account remains disconnected,
  so an actual scheduled draft was not tested.

## Issues found

- Group chat shows a retryable “This chat didn’t open” error in the platform
  admin church-switch session. The server intentionally denies chat tokens to
  impersonating platform staff. The UI should explain this restriction instead
  of implying a transient outage. On a later QA browser visit, the same group
  chat opened and displayed the earlier QA test message; this does not explain
  the initial error or establish the active account's permissions. Chat still
  needs a controlled real church-admin account test. The local client now treats
  an unauthorized token response as an account-access message without a futile
  retry button; a provider outage still offers retry. The exact initial HTTP
  response was not captured, so this needs browser verification after rollout.
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
  Local migration `0114_group_gathering_atomic_update.sql` now saves the
  meeting, attendance window, and audit event in one transaction. Rollback,
  zero-attendee history, and role-access tests pass in disposable PostgreSQL.
- The QA meeting's attendance form loaded the QA member and accepted a local
  selection and note, but saving before the meeting's one-day attendance
  window returned “Attendance opens the day before the gathering.” Nothing
  was saved; the unsaved-change prompt discarded the trial input correctly.
  The local form now explains the timing rule and disables editing until the
  attendance window opens. A separate QA meeting subsequently verified actual
  attendance recording and correction as described above.
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
  is not deployed. The local recovery list also recognizes pending rows with
  a prior publisher, and a read-only QA query returned both affected items.
  This avoids backfilling every pending draft, since some were never posted.
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
  unusable invite. The first local fix reordered and checked those writes.
  Migration `0115_atomic_onboarding_completion.sql` now makes all three writes
  one transaction and rechecks the invite under a row lock. A disposable
  database test forced the final invite update to fail and verified that no
  admin membership or church completion persisted. This still needs a fresh
  browser rehearsal after release.
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
- A recording-settings database read error was silently treated as a missing
  settings row. In that case, the setup page could falsely show the defaults,
  including "Let me review first", even if the saved church choice was automatic
  publication. The local read now fails visibly on database errors; an actual
  missing row still gets defaults. Both cases passed focused tests. This is
  not deployed or browser retested.
- A new church could not start the browser studio before its first Go live:
  the studio configuration endpoint only read stream credentials, while the
  first Go live or stream-key reveal created them. The QA browser reproduced
  the failure, then connected successfully after Go live provisioned the
  credentials. The local studio request now provisions credentials for an
  authenticated church admin through a same-origin POST before connecting;
  integration read errors now fail rather than masquerading as a missing key.
  This needs a first-use browser retest after rollout.
- Ending a browser-camera service did not stop local capture. The QA recording
  ended and became playable, but Safari still showed active media capture on
  the ended-service screen until navigation unmounted the studio. The local
  End service success path now stops the studio immediately. This needs a
  browser retest after rollout.
- Messages & email showed “On. A new draft appears each Monday” for the QA
  church despite having no connected Gmail or iCloud Mail, so the weekly job
  has nowhere to create that draft. The local settings panel now checks the
  actual mail channel and says it is waiting for a connected mailbox, with a
  link to Connected accounts. It also explains when platform email is off.
  This wording needs a browser retest after rollout.
- Unpublished Website preview is publicly reachable in the deployed app by
  adding `?preview=1` to the predictable `/sites/<slug>` address. Safari Private
  Browsing, with no staff session, rendered the QA draft; the same address
  without the query returned 404. This exposes draft website content and its
  visit form. The local route now requires same-church website access for a
  draft preview, uses the same guard for page metadata, and avoids shared page
  caching so unpublishing is checked on every request. The draft contact API
  also rejects direct anonymous submissions while allowing authorized staff
  to test the form. This is a release blocker until rollout and private-browser
  verification. Dynamic public-site rendering needs a hosted load check before
  claiming 100-church capacity.
- The page-status and site-setting values can disagree after a partial live
  publish write. The local public page and contact form now require both to say
  published before allowing anonymous access, and fail closed if either
  publication read fails. The editor's live indicators use the same rule. A
  focused test covers each disagreement. This needs
  a production browser retest after rollout.
- A separate feature-flag read error previously defaulted Website to enabled
  on public routes, even if a platform admin had turned it off. The local
  website and contact-form routes now deny access when that read fails. A
  focused test covers the error, explicit off, explicit on, and untouched
  default cases. A compiled local build against synthetic data showed the
  Website-off page as 404 and rejected a contact POST with 404 and no stored
  submission. The synthetic rows were removed. A production failure-path
  retest is still needed after rollout.
- After the QA welcome desk paired, the dashboard still said “Waiting to be
  set up” until its station list refreshed. The local panel now checks briefly
  while the one-use pairing code is displayed and also offers Refresh station
  status. Its station-list query reports read failures instead of
  turning them into an empty list. The active-display and service-setting
  reads also fail visibly instead of treating a database error as “off”; a
  focused failure-path test covers the active-display read. Controls stay
  disabled until display and station state load. This needs a browser retest
  after rollout.
- Code review found that the live Website publish switch writes page status
  before site settings. A failure on the second request could leave the page
  published while the control reports failure. Local migration 0121 and the
  website action now perform both writes in one database transaction. A forced
  second-write failure rolled back publication in a disposable database. The
  switch still needs a browser retest after migration and code rollout.
- The QA camera recording remained in the Ready to publish list and absent
  from Published. Its review page played back the 48-second clip, exposed
  trim, cover, audience, metadata, and publication controls, and successfully
  saved a trim. The trim was restored to the original 0:00–0:48 span and the
  list showed the full duration again. Publication was not tested, so app and
  public website playback after publication remain unverified.

## Still in progress

- A fresh browser rehearsal of the one-email local fix and failure paths,
  plus optional provider connections, payment processing, and mobile push.
- Other media, recording publication in the app and website, group chat as
  church staff, payment/bank onboarding, external integrations,
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
The live first-use and capture-shutdown fixes passed TypeScript checking,
targeted lint, 1,794 unit/security/policy tests, and an optimized production
build. The loopback relay test needed permission to bind to 127.0.0.1 in the
local sandbox; it passed when run with that permission. Existing lint warnings
remain outside the changed streaming files. No code was pushed or deployed.
The weekly-email readiness wording passed TypeScript checking, targeted lint,
and all 28 settings/help checks. It has not been deployed or browser retested.
The draft-preview access fix passed 446 security checks, focused contact-form
checks, TypeScript checking, targeted lint, and an optimized production build.
An anonymous Safari visit to the patched local app, reading the existing QA
church, displayed a 404 page for the same `?preview=1` URL that leaked on the
live deployment. The local server was stopped after this read-only check. The
build reports the existing warnings outside these files. Its live
private-browser retest remains pending until the local fix is deployed.
