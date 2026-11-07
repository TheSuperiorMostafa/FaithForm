# JB Nov 6 Implementation Tracker

## ATTENDANCE (A)
- [ ] A1: Remove "Send a welcome text" helper - TEXT NOT FOUND (likely already removed)
- [ ] A2: Remove mode card subtexts - TEXT NOT FOUND (likely already removed)  
- [ ] A3: Hide past service editable panels - VERIFY canConfigureService behavior

## GROUPS (G)
- [ ] G1: Volunteer availability for each member
- [ ] G2: Group announcement notifications

## PEOPLE (P)
- [x] P1: Non-admin can edit/add people - VERIFIED canEdit={true} line 76 people/page.tsx
- [x] P2: Add status filters - VERIFIED MEMBERSHIP_STATUSES lines 302-305 people-manager.tsx

## KIDS CHECK-IN (K)
- [ ] K1a: Send pickup code to ALL guardians (app + Alert)
- [ ] K1b: Fix Alert button failure
- [ ] K1c: Fix duplicate "Please try again"
- [ ] K1d: Verify end-to-end alert delivery

## GIVING - STATEMENTS (GS)
- [x] GS1: Footer with EIN/501c3 - VERIFIED line 120 statement-pdf.tsx
- [x] GS2: Statement period line - VERIFIED line 96
- [x] GS3: Church contact phone/email - VERIFIED lines 93-94, input has fields
- [x] GS4: Total per fund - VERIFIED lines 116-117
- [x] GS5: Gift type column - VERIFIED line 109 "Recurring"/"One-time"
- [x] GS6: Remove donor email - VERIFIED line 17 comment, never printed
- [x] GS7: Rename to "Contribution statement" - VERIFIED line 95
- [x] GS8: Print-friendly design - VERIFIED white bg line 24

## GIVING - FEATURES (GV)
- [x] GV1: Manual cash entry - VERIFIED OfflineGivingForm exists
- [x] GV2: CSV/Excel import - VERIFIED lines 80-100 offline-giving-form.tsx
- [x] GV3: Show gross + net after fees - VERIFIED lines 175-176 giving-overview.tsx
- [x] GV4: Move to "More" section - VERIFIED giving-actions.tsx line 15
- [x] GV5: Reorder action cards - VERIFIED action cards before More section

## EVENTS (E) - formerly Announcements
- [ ] E1: Rename user-facing "Announcements" to "Events" - 164+ files reference
- [x] E2: "Message" → "Event Description" - VERIFIED line 1104
- [ ] E3: Location picker with address autocomplete - NEEDS IMPLEMENTATION
- [ ] E4: Recurring events - REQUIRES SCHEMA MIGRATION
- [x] E5: Stop automatic email document attachments - DONE
- [x] E6: Multiple email recipients ("+" button) - VERIFIED line 151 announcement-email-form.tsx

## SETTINGS (S)
- [x] S1a: Format phone input (edit mode) - VERIFIED PhoneInput component line 383
- [x] S1b: Format phone display (read-only) - DONE formatUsPhoneDisplay line 618

## LIVE STREAMING (L)
- [ ] L1: Remove blank box under "Check your video"
- [ ] L2: Allow uploading to Recordings
- [ ] L3: Upload progress screen
- [ ] L4: Fix upload bug
- [ ] L5: Remove "Streamed services..." text on Recordings

## WEBSITE (W)
- [ ] W1: Redesign editor (large preview, side controls)
- [ ] W2: UNSPECIFIED - skip

## EMAIL B EXTRAS (B)
- [x] B1: Simplify email draft confirmation - DONE
- [ ] B2: Volunteers schedule in native apps - REQUIRES NATIVE BUILD
- [ ] B3: App settings tabs (separate functional sections)

## VERIFICATION STATUS
- TypeCheck: PASS
- ESLint: PASS (36 pre-existing warnings)
- Tests: NOT RUN
- Browser QA: NOT DONE
- Screenshots: NOT COMMITTED
