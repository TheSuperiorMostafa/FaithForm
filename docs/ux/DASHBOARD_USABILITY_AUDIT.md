# FaithForm Web Dashboard: Usability & Simplicity Audit

**Date:** 2026-09-25 · **Scope:** web dashboard only. No iOS or Android code was read for findings, and none was changed. · **Method:** a static audit of routes, components, server actions and domain logic, cross-checked against UX research.

- The most serious claims were re-verified by hand in the code. They are marked **✔ verified**.
- The app was not run against live data, so the findings describe what the code renders.
- Companion document: [`DASHBOARD_SIMPLICITY_STANDARD.md`](./DASHBOARD_SIMPLICITY_STANDARD.md), the rules future work is held to.

---

## 0. Executive summary

Several newer parts of the dashboard are simple and humane: the Member App church page editor, the website autosave, the weekly attendance success screen, the kids-roster search and the recording failure copy. The product still has the right bones.

The complexity debt sits in five systemic problems and a handful of real safety or correctness bugs.

**Systemic problems:**

1. **You can't find your way around without hovering or a desktop.**
   - The desktop sidebar is an **icon-only rail that only shows labels on hover**, and the code deliberately gives no way to pin it open (`lib/dashboard/sidebar-layout.ts:10-12`) ✔.
   - On phones, **Settings and Help can't be reached at all**, because the bottom bar drops `sidebarOnly` items (`components/dashboard/bottom-nav.tsx:21-23`) ✔.
2. **Engineering language leaks everywhere.**
   - About 45 server actions return raw Supabase `error.message`.
   - Users can see developer commands ("run `pnpm db:faithform-push`", `app/dashboard/announcements/actions.ts:487`) ✔.
   - Vendor names appear (Retell, Stripe requirement keys, Twilio bodies), as do raw enum values (`In_transit`, `Past_due`) and streaming or DNS terms.
   - No shared error-translation helper exists.
3. **Nothing is forgiving.**
   - About 15 destructive actions fire on one click with no confirm, and **no undo exists anywhere in the product**.
   - The long editors (announcements, sermons, group modal) lose work silently.
4. **Features were built around the system model, not the church's job.**
   - Announcements must be calendar events.
   - Sermons can only be saved by downloading a PowerPoint.
   - Kids check-in needs a household built by hand elsewhere before a visitor's child can be checked in.
   - Giving setup lives in Settings.
   - Church info is edited in three places and the logo in four.
5. **Density crept in.**
   - 423 lines of `text-xs`, 51 at 9–11px, and 154 `size="sm"` (40px) buttons.
   - Tab counts: Website 7, Settings 6, Groups 6 + 6, and Check-in has two stacked tab bars.
   - **The main primary button is white on gold at 2.46:1 contrast**, which fails WCAG AA (`components/ui/button.tsx:11`, `app/globals.css:19-20`) ✔.

**Fix-now bugs found during the audit (not just UX):**

| # | Bug | Evidence |
|---|---|---|
| 1 | Adding someone to a household **defaults them to "Guardian"**, which gives pickup authority. A child added in a hurry can collect other children. | `<Select required>` with no placeholder, first option `guardian` (`types/checkin.ts:1-5`, `member-care-panel.tsx:512`, `household-detail.tsx:226`) ✔ |
| 2 | Year-end giving statements are always for the **current** year. In January, the legally important run produces the new, empty year, and no year picker exists. | `statements/page.tsx:30`, `api/dashboard/giving/statements/generate/route.ts:31-32` ✔ |
| 3 | Attendance save is not atomic. If the entries insert fails, the Sunday is locked as "Completed" with no names and can never be re-saved. The raw DB error is shown. | `attendance/(record)/[date]/actions.ts:136-190` ✔ |
| 4 | A submitted Sunday can't be corrected, and a kids check-in can't be undone (no void action exists). | `[date]/actions.ts:146`; `checkin/actions.ts` export list ✔ |
| 5 | Follow-up **texts go out with no preview of the words and no confirmation**. | `follow-up-board.tsx` `handleSend`; wording picked server-side in `lib/attendance/send-follow-up-texts.ts:159` |
| 6 | Onboarding always shows "Church profile saved ✓", even when it wasn't saved. | `components/onboarding/steps/step-done.tsx:44-45` (`|| true`) ✔ |
| 7 | Sermon series → "Generate sermon for this week" drops the series and scripture. | `sermon-builder/new/page.tsx:49` reads only `topic` ✔ |
| 8 | Revoking pickup authorization, replacing pickup codes, deleting a check-in room, and cancelling a service all happen with one click and no confirm. | See §4.3, §4.2 |
| 9 | Primary button contrast is 2.46:1, and 2.0:1 on hover. | ✔ as above |
| 10 | Unsubmitting an announcement removes it from the app, but the confirmation doesn't say so. | `published-switch.tsx:170-184` vs `actions.ts:775-778` |

---

## 1. Research basis (Phase 1)

Condensed from NN/g, WCAG 2.2, GOV.UK, Microsoft Inclusive Design, Shopify Polaris and research on older adults. Links are inline in the Standard.

| Principle | What the evidence says | What it means for FaithForm |
|---|---|---|
| Older users | 65+ users reach 55% task success vs 75%, are 43% slower and make about twice the errors. Small text, small targets and bad error messages dominate. | Design the default for persona A; D still benefits. |
| Recognition over recall | Visible options beat remembered ones. Tutorials aren't retained. | A labelled sidebar, searchable pickers, "Recent", a setup checklist on Home. |
| Progressive disclosure | Keep frequent items visible. More than two levels loses people. | One "More options" link, never deeper. |
| Plain language | Low-literacy readers read word by word and skip dense blocks (43% of US adults). | Verb-first result labels; no jargon; short sentences. |
| One primary button | GOV.UK: more than one primary "makes it harder to know what to do next". | One solid button per page. |
| Icons | Labels "should be visible at all times"; only home, search and print icons are universal. | No icon-only actions; no hover-only sidebar. |
| Forms | Wizards help novices with *rare* tasks and hurt *repeated* ones. One-thing-per-page suits rare, high-stakes flows. | Wizards for setup (giving, streaming, first run). Short single pages for weekly tasks. |
| Undo vs confirm | Prefer undo. Confirm only irreversible actions, with specific labels. Too many confirms "cry wolf". | Add an Undo toast primitive plus a ConfirmDialog. |
| Status visibility | Acknowledge every action. Confirmation pages say what happened and what's next. | Success panels; one state vocabulary. |
| Autosave | Autosave plus an explicit "Saved" status. Removing Save entirely reduces the sense of control. | Generalize the website `use-autosave` with `SaveStatus`. |
| Dashboards | Home is a launchpad: what needs attention, the next action, setup progress. Few metrics, no vanity numbers (Polaris, Stripe). | Rebuild Home around "Needs you" plus task tiles. |
| Tables vs lists | Tables are for comparing, sorting and exporting; lists or cards are for scanning items. | People, groups, calls and recordings as big rows. Gifts stay a table. |
| Numbers to remember | Targets 44px or more (Apple, WCAG AAA), 48px for this audience. Body 16px or more, secondary 14px or more. Contrast 4.5:1 or better. At most 2 disclosure levels. 3–5 mobile tabs. 1 primary button. | Encoded in the Standard. |

---

## 2. Surface inventory (Phase 2)

Sidebar source: `components/dashboard/nav-items.ts`. Every row is feature-gated. `sidebarOnly` rows are hidden on mobile.

| Sidebar row | Routes (web) | Tabs / sub-surfaces | Main dialogs, forms, states |
|---|---|---|---|
| **Home** (icon `LayoutDashboard`) | `/dashboard` | none | Hours-saved hero plus range picker, 3 stat cards, "Your Weekly Inputs" (3 tiles), attendance chart; no-church state |
| **Attendance** | `/dashboard/attendance` (Weekly), `/[date]` (record), `/follow-up`, `/follow-up/log`, `/services` ("Events"), `/setup` ("Automatic Attendance") | 5 section tabs | Attendance wizard, add-visitor dialog, summary, follow-up board, service board plus roster, check-in display pairing, 4-step setup accordion (map, services, window, go live) |
| ↳ **Kids check-in** (tab of Attendance) | `/dashboard/checkin` (Today), `/checkout`, `/locations` (Rooms), `/stats`; `/checkin/households*` redirect to People | 4 sub-tabs *under* the 5 Attendance tabs | Roster board, checkout console (QR, code, override), rooms manager, stats; tablet `/checkin/kiosk` pairing |
| **People** | `/dashboard/people`, `/people/households`, `/people/households/[id]` | People · Households; person panel has 4 tabs (Details, Care, Documents, Household) | Join requests, identity claims, "In your app, not in People" panels; add/edit panel; deactivate confirm; document upload; household detail (members, pickup list, weekly code) |
| **Groups** | `/dashboard/groups/[[...path]]`: list, messages, requests, insights, moderation, settings, `/<id>/{overview,chat,members,gatherings,requests,settings}` | 6 top tabs plus 6 group tabs | Create/edit group modal (~18 fields), gathering modal (~19), add-people modal, remove-member modal, archive then type-to-delete, invite link; Stream Chat |
| **Announcements** | `/dashboard/announcements` (`/new` and `/[id]/edit` redirect) | none; 3 stacked sections | Weekly email draft queue, month calendar plus side panel, verify form (~1,500 lines), create-event dialog, unsubmit dialog, delete-event dialog, email template |
| **Sermon Builder** | `/dashboard/sermon-builder`, `/new`, `/[id]`, `/[id]/edit`, `/[id]/discussion`, `/[id]/social`, `/series/new`, `/series/[id]` | Sermons · Series | Simple builder (passages, theme catalog), detail (lesson, share-in-app, presentation linker), legacy editor, series planner |
| **Live Stream** | `/dashboard/live-streaming` (Broadcast), `/recordings`, `/recordings/[id]`, `/media` (Library), `/media/all`, `/media/series[/slug]`, `/media/tag/[axis]/[value]`, `/media/[id]` (redirect), `/setup`; legacy `/dashboard/media` redirects | Broadcast · Recordings · Library · Setup | Control center (ready, waiting, live, post-live), end dialog, studio (browser camera), schedule form, presentation linker, recording review (details, trim, publish, unpublish, delete via ⋯), 6 setup cards (encoder, key, pairing, recording defaults, destinations, embed) |
| **Call Log** | `/dashboard/call-log`, `/call-log/[id]`; `/dashboard/voice-assistant*` is platform-admin only | none | Calls table (100 rows), re-score, sync, scoring explainer, call detail |
| **Giving** | `/dashboard/giving`, `/gifts`, `/donors`, `/recurring`, `/payouts`, `/statements` | link-pills (no tabs) | App fund-publishing panel, stat cards, QR card, gifts table plus 6 filters plus CSV, refund inline confirm, recurring pause/resume/cancel, statements ZIP |
| **Website** | `/dashboard/website`, `/pages`, `/details`, `/design`, `/sermons`, `/messages`, `/domain` | 7 tabs | Site builder first run, publish switch, section editor (autosave), details (autosave), themes, sermons table, contact inbox, domain workspace (DNS table) |
| **Member App** | `/dashboard/app` | none (jump bar) | Join requests, church info editor plus phone preview (Save & publish), visibility and campuses, invitations, automatic check-in card |
| **Support** (footer, desktop only) | `/dashboard/support` | none | Ticket form plus ticket list |
| **Settings** (footer, desktop only) | `/dashboard/settings` | General · Integrations · Team · Communications · Attendance · Giving | Profile images (above the tabs), theme, church branding (hex), Google/iCloud/Apple-ID/Facebook/YouTube/relay, team invite plus manage dialog, email template plus attachments, 5 follow-up SMS templates, Stripe/funds/EIN/slug |
| (no nav row) | `/dashboard/library` | none | Monthly PDF reports, reachable only via Settings › General › Resources › "Documents" |
| Outside the shell | `/login`, `/setup`, `/onboarding?token=` | none | Magic link vs password toggle; 2-step self-serve setup; 6-step invite onboarding |

**Shared primitives** (`components/ui`):
- button, input, select, textarea, tabs, dialog, dropdown-menu, switch, date-picker, color-picker, phone-input, skeleton
- The Groups area has its own separate kit (`components/groups/shared.tsx` + `groups.css`).

**Error boundaries:** only one in the whole dashboard, `app/dashboard/groups/error.tsx`. There is no root `error.tsx`, `global-error.tsx` or `not-found.tsx`.

---

## 3. Major complexity problems (Phase 5)

| # | Problem | Severity | Evidence |
|---|---|---|---|
| P1 | The sidebar is icons only until hovered; there is no pin; church name, role and Sign out are hidden when collapsed | **CRITICAL** | `sidebar-layout.ts:67-78`, `sidebar.tsx:88-95,181,286,297` ✔ |
| P2 | Settings, Team and Help are unreachable on mobile; the bottom bar squeezes up to 11 tabs at ~34px with 11px labels | **CRITICAL** | `bottom-nav.tsx:21-23,54,67` ✔ |
| P3 | Raw backend errors in UI: ~45 action returns of `error.message`, ~50 verbatim toasts, HTTP codes, `pnpm` commands, Twilio bodies, Stripe errors | **CRITICAL** (for A–C this reads as "I broke it") | e.g. `team-actions.ts:121,157,209`, `giving-actions.ts:62…`, `people/file-actions.ts:121`, `lib/sms/send-sms.ts:33`, `sermon-editor.tsx:78` |
| P4 | No undo anywhere; ~15 one-click destructive actions; `window.confirm` and `window.prompt` in Giving and Integrations | **HIGH** (CRITICAL where child safety is involved) | §4 tables |
| P5 | Work loss: announcement form, sermon builder, group and gathering modals, church profile have no autosave or leave guard | **HIGH** | `announcement-verify-form.tsx`, `simple-sermon-builder.tsx`, `group-form.tsx`, `gatherings.tsx` |
| P6 | Same data edited in many places: church name, address and service times in 3 places, logo in 4, app look in 3; different save models | **HIGH** | `church-info-editor.tsx`, `details-form.tsx`, `service-schedule-editor.tsx`, `church-branding-images.tsx`, `giving-branding-settings.tsx` |
| P7 | Primary button contrast 2.46:1 | **HIGH** (affects every CTA) | `button.tsx:11` ✔ |
| P8 | Density: 423 `text-xs`, 51 at 9–11px, 154 `size="sm"`, 108 raw `<button>`s, `groups.css` 9–13px with hard-coded hex | **MEDIUM** | cross-cutting sweep |
| P9 | Tab overload: Website 7, Settings 6, Groups 6 + 6, Attendance 5 + Kids 4 stacked | **MEDIUM** | layouts listed in §2 |
| P10 | State vocabularies drift: Pending, Submitted, Published and Verified are one state; Recording ready vs Ready to publish; raw lowercase `draft`/`published`; raw event status | **HIGH** | §4.5–4.7 |
| P11 | A failed load looks empty: payouts, service board | **HIGH** | `payouts/page.tsx:29-33`, `services/actions.ts:127` |
| P12 | Home isn't a launchpad: actions sit below ~400px of metrics; the hours-saved number is unexplained; there is no setup checklist or "needs attention" | **HIGH** | `app/dashboard/page.tsx:64-91` |
| P13 | Skeleton rule violations: 22 routes inherit mismatched skeletons; static text shimmers in Settings, Recordings, People and Groups | **LOW** | `settings/loading.tsx`, `recordings/loading.tsx`, `people/loading.tsx`, `checkin/loading.tsx` |

---

## 4. Feature-by-feature findings and CURRENT → PROPOSED (Phases 4, 9, 10)

Severity tags: **[C]** critical, **[H]** high, **[M]** medium, **[L]** low.

### 4.1 Shell, Home, onboarding

**Findings**
- **[C]** P1 and P2 above.
- **[H]** Home order is hero, then stats, then actions. "Your Weekly Inputs" is a leftover name from a dead component (`quick-actions.tsx`, which is dead code). "Add announcement" goes to the list, not a composer. "Phone calls" links to the call log even without the feature. "SM posts" and "PowerPoints created" are jargon and look clickable but aren't. A new church sees "0 hrs" and "Log attendance to see trends here." with no checklist.
- **[H]** Hours saved: fixed per-automation estimates (`lib/automation-catalog.ts`) presented as fact, with no explanation.
- **[H]** Two first-run flows. `/setup` has 2 steps and ends on an empty dashboard; `/onboarding` has 6 steps and a false ✓. `/login` has no "Start a new church" link. Time zone is asked for instead of inferred.
- **[M]** The topbar shows "DASHBOARD / {church}" on every page, so it never tells you where you are. The Home icon is a grid, not a house. Sign out on mobile is icon only.
- **[M]** Locked features show "Not enabled" / "Unavailable" and don't say who can turn them on.

**First run.**
- *Current:* know the `/setup` URL → name, email, password → maybe email round-trip → church name + time-zone select → empty Home showing "0 hrs" → guess where to add address and service times (3 candidate places).
- *Proposed:* a "Start a new church" button on `/login` → one screen (your name, church name, email, password; time zone inferred) → Home with a **"Finish setting up" checklist**:
  - Service times
  - Logo
  - Invite your team
  - Calendar
  - Giving
  - Live stream

  Each item deep-links and ticks itself off when done. The hours hero stays hidden until there is data.

**Home as a launchpad.**
- *Current:* metrics first; 3 link tiles below the fold.
- *Proposed:*
  1. Greeting and date.
  2. **"Needs you" cards**, only when there is something:
     - "1 recording ready to publish"
     - "3 new join requests"
     - "2 calls need a call back"
     - "Stripe needs your bank details"
     - "Calendar needs reconnecting"
  3. **6 big task tiles**, filtered by feature and ordered by weekday. On Sunday, Go live and Check in come first:
     - Post announcement
     - Record attendance
     - Check kids in
     - Go live
     - Add person
     - Message a group
  4. At most 3 plain metrics with one-word trends ("Sunday attendance 142 ↑").
  5. Hours saved becomes a small, explained card ("Estimated time FaithForm saved you this month").

### 4.2 Attendance & Kids check-in

**Findings**
- **[C]** Fix-now bugs 3 and 4: atomic save; edit a submitted Sunday; void a check-in.
- **[C]** **A first-time visitor child can't be checked in from the desk.** It needs a household with the child as Child (`checkin/actions.ts:569-571`), built in People through an **unsearchable whole-church `<select>`** (`household-detail.tsx:213`).
- **[C]** **Parents never get a pickup code at check-in, yet checkout requires one.** Success is just the toast "Checked in." (`roster-board.tsx:115`). There is no code on screen and no label printing, so the "No phone, no code" override becomes the normal path.
- **[H]** There is no headcount-only mode; Submit is disabled until every member is marked (`attendance-wizard.tsx:515`). Sundays only, last 8 only. Weekday services can't be recorded by hand.
- **[H]** Families are checked in one child at a time. Pre-checked children need a second search instead of a "Receive" button.
- **[H]** No confirm on "Cancel service" (no un-cancel), "Mark everyone present" (whole church), room Delete, or "Replace it" pickup code.
- **[H]** A board that fails to load looks empty: "No attendance events yet".
- **[M]** Services go by four names: Events, Events & services, Services, Services board. Service times live under "Automatic Attendance". The Setup step 1 is a geofence map with radius in metres and lat/long, placed before "add your service times".
- **[M]** Jargon:
  - credential, override, "Pre-checked in, not yet received"
  - "Refresh from schedule", "Check-in area radius", "Arrival confirmation"
  - "Make the adult default", "Cap.", "Order"
  - "Check-In has not been set up on this database yet."
  - raw ISO dates ("Showing 2026-09-25")
- **[M]** Small targets:
  - room move select `h-8 text-xs`
  - "Override…" `text-xs` link
  - 36px search results
  - 36px day circles
  - 28–32px pills
- **[M]** Two stacked tab bars, and the width jumps from `max-w-3xl` to `max-w-6xl`.

**Returning family (2 kids).**
- *Current:* Attendance → Kids check-in → type a name → pick child 1 → room → Check in → toast; repeat for child 2; the parent gets nothing.
- *Proposed:* **Check-in desk** → type any family member's name → tap the family card (all kids pre-ticked with default rooms) → **"Check in 2 children"**. A full-screen success shows the **pickup code in large type** (with optional labels) and a 10s **Undo**.

**First-time visitor family.**
- *Current:* about 15 or more actions across Attendance, People and Households, while the family waits.
- *Proposed:* **"New family"** on the desk: parent name and phone, then each child's name, age and allergies → **"Save & check in"**. This creates the people, the household and the guardian, checks the children in and shows the code.

**Checkout.**
- *Current:* type or scan → tick kids → "Released to" (defaults to "Not recorded") → Confirm release → toast.
- *Proposed:* scan or type the code → kids pre-ticked, guardians shown as big buttons → **"Released to Sarah"** → full-screen "2 children released" with **Undo**.

**Weekly attendance.**
- *Current:* Weekly → pick a Sunday → mark every member → Submit; no corrections, Sundays only.
- *Proposed:* pick any service (Sunday or weekday) → **"Just a number"** (one field) *or* **"By name"** (unmarked counts as not here, autosaved draft) → Save. **Edit** stays available later.

**Setup.**
- *Current:* Automatic Attendance accordion (map first), Kids Rooms (admin), households by hand, no checklist.
- *Proposed:* the Home checklist items "Add your services" (templates), "Add kids rooms" (suggested Nursery, Preschool, Elementary) and "Optional: automatic phone check-in". The map and radius appear only if that last option is chosen; radius and coordinates are inferred.

### 4.3 People, Families (households), Groups, Messaging

**Findings**
- **[C]** Fix-now bug 1: the relationship defaults to Guardian.
- **[C]** **You can't contact anyone.**
  - There is no `tel:`, `sms:` or `mailto:` link, and no direct message on the web.
  - The "Text ready" badge (`people-manager.tsx:371`) promises an action that doesn't exist.
  - Group "messages" are in-app chat only, so members not on the app never get them.
- **[C]** Fix-now bug 5: follow-up SMS with no preview and no confirm; the wording lives in Settings › Attendance.
- **[H]** Raw DB and developer text in People: "Run `pnpm storage:buckets`" (`file-actions.ts:121`), "…not set up on this database yet."
- **[H]** Instant, unconfirmed household changes:
  - remove member (icon-only trash)
  - relationship change
  - revoke pickup
  - replace code
  - document delete (icon-only, permanent)
- **[H]** Create a group, then add people separately. You land on Overview, and "Add people" is two clicks away. The search hides ticked people once you type a new query. The capacity error offers "add them anyway", which the UI can't do.
- **[H]** Groups has 12 tabs across 2 bars, with no count badges (counts are never passed, `page.tsx:67`). Headings are slogans: "Better together.", "A place to belong.", "Keep the connection going.", "Care for the conversation.", "A healthy space for everyone.", "See your community grow."
- **[M]** The group form shows 8 fields up front and 10 collapsed. Server field errors can sit inside a collapsed section. "Safety profile" and "Manager" are unexplained.
- **[M]** One person panel has three save models: Details Save, Care "Save care details", and Household instant.
- **[M]** Up to 3 wordy reconciliation panels sit above the People list. Identity claims need radio lists plus 4 buttons.
- **[M]** A new household doesn't open after you create it, and households can't be renamed or deleted.
- **[L]** `groups.css` uses 9–13px type and its own colours.

**Add person.**
- *Current:* Add Person → 4 fields → Add person → panel flips to 4 tabs. This is good.
- *Proposed:* keep it. Mark Phone "(optional)". After saving, show **"Add to a family"**, **"Add to a group"** and **"Add another"**.

**Contact a person.**
- *Current:* not possible.
- *Proposed:* on each person, **Call**, **Text** and **Email** buttons (`tel:`, `sms:`, `mailto:` first; an in-product composer later).

**Create group with people.**
- *Current:* 18-field modal → Overview → Members → Add people → search, tick, re-search → role → Add n. That is about 10 or more steps.
- *Proposed:*
  1. **"New group"**: name, plus an optional "What kind of group?" chip.
  2. **"Who's in it?"**: a searchable list with chosen people as chips and a ★ for the leader.
  3. **Create group** → lands on Members with "Group created. 8 people added."

  Everything else defaults; privacy, chat rules and size go in group Settings.

**Message a group.**
- *Current:* Groups → Messages tab → 12px list → "Connecting…" → Stream composer; app users only.
- *Proposed:* a **"Message"** button on every group and person, opening one composer: **Who?** (pre-filled) → **What?** → **When?** (Now or Schedule). Delivery is automatic: app, then text, then email, per person. The composer shows "Reaches 14 of 18 (4 have no phone or app)". A preview and **"Send to 18 people"** confirm come before sending.

**Put someone in a family.**
- *Current:* person → Household tab → maybe leave the panel to create a household → find it → whole-church select → "As" defaults to Guardian → Add.
- *Proposed:* **"Put Maria in a family"** → type-ahead family *or* "Start the Lopez family" → required question, "Is Maria a parent/guardian or a child?" (no default) → done, with Undo.

### 4.4 Live stream, recordings, library

**Findings**
- **[C]** The Library tab mixes preparing, failed and unpublished recordings with published ones and shows no status (`media-library.ts:179-187`). A pastor will assume everything there is in the app.
- **[C]** "Published" is true if the recording is only on the website (`recording-model.ts:455-460`). The app is called both "Faithful app" and "FaithForm app".
- **[H]** Raw errors on Go Live, End and Rename (`live-streaming/actions.ts:270,296,336`). Rename can toast "youtube: <API error>".
- **[H]** Setup exposes a lot of technical detail:
  - Server URL, stream key, H.264, CBR, keyframe interval, NVENC, SRT
  - "RTMP destinations are provisioned…", "Destination handed to the relay"
  - `npm start` shell instructions for "Pair streaming PC"
- **[H]** The Broadcast tab carries an always-open Schedule form (including "Simulated live video") and a presentation linker under Go Live. Raw `scheduled`/`ended` status values show. "Cancel" on a scheduled service has no confirm.
- **[H]** The post-live "ready to publish" panel disappears after 12h or is dismissed client-side. On Monday there is no pointer to the unpublished recording.
- **[H]** "Library" names two unrelated things: the media tab and the PDF reports page (`/dashboard/library`).
- **[M]** State wording drifts: "Recording ready" vs "Ready to publish", "Preparing" vs "Preparing recording", a Live badge under "Preparing". A red "Faithful app — Not set up" appears that the church can't fix. Series can't be renamed. Auto-publish is off by default and not mentioned post-live.
- *Strengths to keep:* stream health is folded away; the end dialog is reassuring; recording failure copy is plain; the key auto-hides.

**First-time setup.**
- *Current:* 6-card Setup page → copy Server URL → Show key → read the Recommended settings card → configure OBS by hand → Test → (npm pairing) → recording defaults → go to Settings › Integrations for YouTube/Facebook → come back.
- *Proposed:* a **"Set up streaming"** 3-step wizard:
  1. **"What do you stream with?"**: OBS, ATEM, vMix, This computer, or Someone else sets it up. Show only that tool's 3 steps, with **Copy both** (or a downloadable OBS profile). Server and key sit under "Show technical details".
  2. "Waiting for your video…" turns into **Connected ✓**.
  3. **"After the service"**: *Publish to the app automatically* or *Let me review first*, plus "Also show on YouTube/Facebook" with inline connect.

  Pairing, SRT, encoder preset and embed code move to **Advanced**.

**Sunday.**
- *Current:* Broadcast (schedule and linker below) → Go Live → Waiting/Live → End → confirm.
- *Proposed:* the Broadcast tab shows only **one state card**:
  - **Ready** ("Video: connected · Recording: automatic") → **Go live**
  - **Live** (timer, Rename, big **End**) → confirm
  - **Processing**

  Schedule moves to its own "Upcoming services" tab. Errors map to plain sentences plus "Get help".

**After the service.**
- *Current:* post-live panel (12h) *or* Recordings → card → details → tick "FaithForm app" → Publish. The item shows "Published", which might mean website only. The Library shows no state.
- *Proposed:* a persistent strip **Processing → Ready to publish → Published** plus a **"1 recording ready to publish"** card on Home and Live until handled. The review page shows title and series pre-filled and one button, **"Publish to app"**, then "Published: members see it in the app under Services" with a preview link. **Merge Recordings and Library into one "Recordings" view** with status chips (All · Needs action · Published · Series). Rename the PDF page **"Reports"**.

### 4.5 Announcements

**Findings**
- **[C]** **Nothing can be announced unless it is a calendar event**, and nothing works until a calendar is connected (`weekly-announcement-queue.tsx:133`). "Office closed" or "Pray for the Smiths" needs a fake event.
- **[C]** App posts **can't be scheduled**. Submitting publishes and **sends a push immediately**, and the form never says a notification will go out.
- **[H]** One state has four names: Pending/Submitted/Published/Verified. The verb is "Unsubmit". The primary button is "Verify & submit", though nothing is verified.
- **[H]** The unsubmit confirm doesn't mention removal from the app, and says "The Google Calendar event is not changed" even for iCloud churches.
- **[H]** The "Submitted (n)" list renders twice. "Email drafts" is hard-coded to Gmail. The weekly email is only a draft that must be sent from Gmail. The developer `pnpm` command appears in UI.
- **[M]**
  - Turning on "Shared to FB?" silently starts AI generation and blocks submit until an image exists.
  - The attendance editor is embedded inside create-event and the announcement panel.
  - Facebook links are probably broken (raw `post_id`).
  - There is no autosave; closing the panel discards the AI poster.
  - Dead code: `announcement-verify-dialog.tsx`, `announcement-calendar-queue.tsx`.

**Post an announcement.**
- *Current:* connect a calendar (Settings) → New event (5 fields plus an attendance block) → click day → "Verify" → review → 3 switches plus audience → poster/AI → "Verify & submit" → read the banner. For email: "Create weekly draft" → open Gmail → send. That is about 9 decisions.
- *Proposed:* **"New announcement"**:
  1. **What?** Title, message, optional picture ("Make a picture for me").
  2. **Who?** Everyone, or Members only.
  3. **When?** Post now, Schedule, or "Until" date.
  4. **Where?** The app is always on; *Weekly email* and *Facebook* are checkboxes.
  5. A preview, then **"Post"** or **"Schedule"**.
  6. Result: "Posted to the app. 214 people notified. Added to Monday's email."

  Calendar events become **suggestions** ("3 events this week could be announced → Announce"). States are **Draft · Scheduled · Posted**, and the verb is **"Take down"**. The weekly email can **send itself** (opt-in), with the Gmail draft as an option.

### 4.6 Sermon Builder

**Findings**
- **[C]** **The only way to save is "Save & download PowerPoint"** (`simple-sermon-builder.tsx:777`). There is no draft save and no autosave.
- **[C]** There is **no in-browser view or Present mode**; you must use PowerPoint.
- **[H]** Fix-now bug 7 (series link). Discussion and Social pages are unreachable for sermons created through `/new`.
- **[H]** The raw lowercase `draft`/`published` status (`sermon-list.tsx:60`) never goes back to draft after unsharing, and published sermons can't be deleted. "Publish" has two meanings: "Mark published" vs "Share in the FaithForm app".
- **[M]**
  - The date defaults to today, not next Sunday. "Preached on" duplicates Sermon date.
  - "Add" passage is implicit.
  - The theme catalog has 3 filter rows.
  - The presentation linker sits above the deck.
  - Generated lessons can't be edited.
  - Generic "Failed" errors; `Draft failed (500)`.
  - The model-id badge is `text-[10px]`.

**Build and publish.**
- *Current:* New → title, date (today), translation → book/chapter/verse → Add → theme catalog → forced .pptx download → detail → Create lesson → scroll → audience, "Preached on", line → Share in the app.
- *Proposed:*
  1. **New sermon**: title, date (next Sunday), one **Passage** field ("John 3:16-21"); theme auto-suggested with a *Change* option.
  2. Autosave with **Draft · Saved**.
  3. Detail tabs: **Slides** (preview, **Present**, *Download* as secondary), **Lesson** (editable), **Social posts**.
  4. One primary button, **"Publish to app"**. Unpublish asks to confirm and returns to Draft.

### 4.7 Call Log

**Findings**
- **[C]** **You can't act on a call.**
  - Numbers are masked for everyone as `••• ••• 1234` (`lib/utils/voice-assistant.ts:13`) ✔.
  - There is no call-back, no "handled" state, and no Urgent filter or sort.
- **[H]** "Score" rates the **AI assistant**, not how much the caller needs you, but it sits in the main table.
- **[H]** Vendor and maintenance language in church view: "Sync from Retell", "Retell's summary", "Re-score N older calls", "rubric". The scoring explainer is always shown below the table.
- **[M]** The 720px table scrolls sideways on phones. The "View" link is tiny `text-xs`. Legacy `/voice-assistant/calls/[id]` loses the call id. Legacy score notes live in hover-only `title` tooltips.

**Follow up on calls.**
- *Current:* open the log → scan 100 rows for "Urgent" → View → read the transcript → the masked number blocks follow-up.
- *Proposed:* opens on **"Needs a call back (n)"** (urgent first), with an **All calls** tab. Each row: caller, "What they wanted", **Call back** (for admins; a product decision on unmasking). The detail page has a primary **"Mark as handled"**, an optional note, and the transcript collapsed. Score, re-score, sync and explainer move to the FaithForm control center.

### 4.8 Giving

**Findings**
- **[C]** Fix-now bug 2 (statement year). Statements output only as a ZIP of PDFs; there is no email-to-donors, no preview, and no list of donors without an email.
- **[H]** Setup is redirected to Settings and full of Stripe language:
  - "Giving & Stripe", "Payouts enabled", "Save slug"
  - **raw Stripe requirement keys**, e.g. "individual.verification.document" (`giving-card.tsx:146-149`)
- **[H]** There is no "this week" figure. Filtered gifts show a count but no total. Search fires **on blur only**. Donors is a dead end (no search, no click-through).
- **[H]** Refund doesn't show the amount or donor, doesn't say it's permanent, and is offered on gifts the server refuses. Recurring pause/resume/cancel ignore failures and reload the page. A payouts error shows "No payouts yet.".
- **[M]**
  - The fee copy is wrong ("donors pay 2.2% + $0.30 … only"), and so is "IRS Form 990 language included".
  - Raw enums: "In_transit", "Past_due", and `{interval}ly`, which renders "dayly".
  - "Net" and "Disputed" are unexplained.
  - The overview opens with the app fund-publishing panel (4-way visibility) instead of "what came in".
  - "Loading funds…" text instead of a skeleton.
  - `window.prompt` rename; unconfirmed fund removal.
- Gifts and CSV **should stay a table** (treasurer use). Donors and Recurring should be big rows with a click-through.

**Setup.**
- *Current:* Giving → "Set up giving" → Settings › Giving → Stripe → return → maybe "Continue Stripe setup" → funds, EIN, slug → back to Giving → publish each fund (visibility, min, max, suggested). About 8 or more steps across 3 surfaces.
- *Proposed:* a **"Start accepting gifts"** wizard on the Giving page:
  1. Legal name and EIN (pre-filled).
  2. **Connect your bank** (Stripe runs behind "our payment partner").
  3. Funds: "General Offering" pre-checked and published to Everyone with $25/$50/$100 suggestions.
  4. **"You're ready. Share your giving link"** with the QR code.

  Stripe requirements are mapped to plain tasks ("Add your bank account").

**Year-end statements.**
- *Current:* Settings (EIN, address) → Giving → Statements → "Generate all {current year} (ZIP)" → unzip → email each donor.
- *Proposed:* in January a card on Home and Giving: **"2026 giving statements are ready to send."** The year defaults to last year before April. Then confirm EIN and address inline → preview one → **"Email 142 donors"** → confirm (year and count) → "Sent to 142. 6 have no email: download to print." The ZIP stays as a secondary option.

**This week.**
- *Current:* not available.
- *Proposed:* the Giving overview leads with **"This week: $4,210 from 38 gifts"** and **"This year: …"**. Beneath: recent gifts as rows, then *See all gifts* (table).

### 4.9 Website

**Findings**
- **[C]** Once live, **every edit is live instantly**: 900ms autosave, one-click theme change, unconfirmed deletes, "Reset to default", and the Unpublish switch. The hint "Changes show in the preview as soon as you save" is misleading.
- **[H]** 7 tabs. "Sermons" calls sermons "messages" while the "Messages" tab is the contact inbox.
- **[H]** Destructive actions with no confirm:
  - delete sermon (icon-only, hard delete, toast "Message removed.")
  - remove staff or service time (which also changes the phone assistant and attendance)
  - Reset to default
  - Unpublish
  - cancel domain request
- **[M]**
  - Section-editor jargon: "Hero", "Eyebrow", a 3-part headline, "#about", "Custom block".
  - DNS table in 12px mono (A, @, CNAME); no "email these instructions to my domain person"; no way to remove a domain.
  - Raw `error.message` in `domain-actions.ts`.
  - The contact inbox has no Reply button.
- **[L]** 10px chips; 24px up/down arrows.
- *Strengths:* autosave with honest status, plain save-failure messages, and the image uploader (HEIC, downscale, cropper).

**Change the banner photo.**
- *Current:* two places (Details "Cover photo", which also changes the app; or Pages → "Hero" → Edit → "Banner photo" override) → crop → live instantly.
- *Proposed:* **Website home → click the banner in the preview** (or "Change banner photo") → choose and crop → preview → **"Publish change"**. Show a note: "Also used as your app cover" (toggle).

**Connect a domain.**
- *Current:* Domain → "Connect it" → Type/Name/Value table → registrar DNS → "Check now".
- *Proposed:*
  1. **"Use my own address"** → type it.
  2. Offer three **equal** choices: *Step-by-step for {detected provider}*, *Email instructions to the person who manages it*, or *Let FaithForm do it for me*.
  3. FaithForm checks automatically and emails "yourchurch.org is live".
  4. The DNS table sits under "Technical details".

**Draft model.** Introduce **"Edits are saved as a draft · Publish changes (3)"** at site level once the site is live, with "Discard changes". Autosave keeps working and **publishing becomes deliberate**.

### 4.10 Member App

- This is the best pattern in the dashboard: one editor, live phone preview, sticky "Unsaved changes · Save & publish", leave guard, plain field errors. **Use it as the reference implementation.**
- **[H]** "Change what the app shows" is spread across 3 areas: this page, Settings › General › Church branding (hex colours), and Giving (fund visibility).
- **[M]**
  - Campus form asks for **Latitude, Longitude, free-text Timezone, radius in metres**. All are inferable from the address.
  - "Retire" campus has no confirm.
  - Link reorder is icon-sm.
  - 11px counters.
- *Proposed:* three cards on one page, sharing one **Save & publish** and one preview:
  - **Your church page** (as today)
  - **Look** (logo plus colour *swatches*, no hex)
  - **Giving buttons** (fund toggles)

  Campus geo and time zone are inferred; radius goes under Advanced.

### 4.11 Settings (Phase 10 classification)

**A** user must decide · **B** FaithForm can default · **C** FaithForm can infer · **D** rare/advanced · **E** unnecessary here.

| Setting | Now | Class | Recommendation |
|---|---|---|---|
| Church logo / cover (above the tabs, raw file input) | General | A | Move into a single **Church info** card |
| Light / Dark / System | General › Display | B | Default System; move to the account menu |
| "Documents", "Support" links | General › Resources | E | They're navigation; remove |
| Church app theme: logo (duplicate), hex primary and accent, Apply, Reset | General | C / E | Suggest from the logo; swatches; move to Member App › Look |
| Google Calendar connect | Integrations | A | Keep; rename the tab **"Connected accounts"** |
| "Google email" row (same OAuth) | Integrations | E | Merge into one Google row |
| iCloud public link | Integrations | A (alternative) | Keep |
| Apple ID and app-specific password; Apple Mail drafts | Integrations | D | Behind "Other ways to connect" |
| YouTube, Facebook | Integrations | A (if streaming) | Also offer inline in the Live setup wizard |
| Stream relay status | Integrations | E | Remove (control-center concern) |
| Invite: email, role | Team | A | Add a **name** field |
| Feature access grid (up to 13) | Team | B | **Role presets**: Pastor/Admin (everything), Staff, Volunteer (Attendance & Check-in). "Customize" behind a disclosure |
| Temp password | Team | D → E | Replace with an emailed sign-in link |
| Monday email drafts switch | Communications | B (on) | Default on |
| Default recipient | Communications | C | Use the church email |
| Subject / body (placeholders, markdown) | Communications | B / D | Sensible default; editing under "Customize" |
| Weekly email attachments | Communications | D | Keep, collapsed |
| 5 follow-up SMS templates | Attendance | B / D | Show the message **inside the follow-up send flow**, editable there |
| Stripe connect / status | Giving | A | Move into the Giving setup wizard |
| Giving page URL (slug) | Giving | C | Infer from the church name; editable under Advanced as "Web address" |
| Funds (add, rename via prompt, default, remove) | Giving | B / D | "General Offering" by default; manage in Giving |
| EIN, statement address | Giving | A / C | Ask inline when first needed (statements); address from Church info |
| **Missing:** church name, address, phone, email, service times, time zone | — | A / C | New **Church info** section is the single source of truth |
| **Missing:** your name, photo, password | — | A | New **My account** (avatar menu) |

**Proposed Settings tabs:**
- **Church info**
- **Team**
- **Connected accounts**
- **Messages & email**
- **Advanced**

Giving and Attendance configuration moves into those features' own pages.

---

## 5. Empty, error, success and loading states (Phase 11)

| State | Good examples to keep | Problems to fix |
|---|---|---|
| Empty | "No recordings yet — Every livestream is recorded automatically…" + "Go to Broadcast"; "No households yet. Create one, then add people to it."; Groups `Empty` component | "No data to chart."; "No statement data yet."; "No church linked" (8 sites, dev phrasing, no next step); "No number is bound to this agent in Retell yet."; "No rooms yet… under **Rooms**" (not a link). No shared `EmptyState` outside Groups. |
| Error | Website `save-failure.ts`; Groups `runStaffAction`; recording failure copy; checkout errors ("That code is from a previous week.") | About 45 raw `error.message` returns; "Failed"/"Error" one-worders; `Draft failed (500)`; "Stripe is not configured"; "Forbidden"; `pnpm` commands; Twilio body in follow-up log; failed loads shown as empty (payouts, service board); **only 1 `error.tsx`** in the dashboard. |
| Success | "Attendance saved!" screen; "Unpublished. The recording is still saved."; "Check-in display stopped. Nobody already counted was affected." | Silent: funds set/rename/remove, recurring actions, integrations disconnect (message lost to redirect), statements ZIP. Too small for the moment: "Checked in.", "Released 2 children.", "Moved.", "Saved.". Wrong noun: "Message removed." for a sermon. |
| Loading | Most routes have skeletons; the live status poll has an sr-only live region | 22 routes inherit mismatched skeletons; static text shimmers (Settings, Recordings, People, Groups); "Loading funds…" and "Loading…" plain text; check-in skeleton heights and grid differ from the page. |

---

## 6. Proposed navigation (Phase 7)

Principles:
- labels always visible
- grouped by church job
- ≤ 5 on the mobile bar with **More**
- Help and Settings always reachable
- feature-gating still hides what a church doesn't have

**Desktop sidebar** (240px, always expanded on ≥ `lg`; collapsible *with a visible toggle* on `md`, remembered per user):

```
⌂  Home

EVERY WEEK
👥 People            (People · Families)
◎  Groups            (includes group messages)
📣 Announcements
✓  Attendance        (Sunday count · Services · Follow-up)
🧒 Kids Check-in     (Check in · Pick up · Rooms · Reports)
●  Live              (Go live · Recordings · Upcoming · Setup)
📖 Sermons

YOUR CHURCH ONLINE
♥  Giving
🌐 Website
📱 App
☎  Phone Calls

──────────
?  Help              (always visible, same place: WCAG 3.2.6)
⚙  Settings
[avatar] My account · Sign out
```

**Changes from today:**
- **Kids Check-in becomes its own row.** It's used at speed during arrival and shouldn't sit under a second tab bar inside Attendance. This also removes the width jump.
- "Live Stream" → **Live**; "Sermon Builder" → **Sermons**; "Call Log" → **Phone Calls**; "Member App" → **App**; Households → **Families** (under People).
- **Team** moves from a Settings tab to *Settings › Team*, *and* gets an "Invite someone" tile on Home for admins.
- "Library" (PDF reports) becomes **Reports** under Attendance. The Live "Library" tab merges into **Recordings**.
- Two light group headings ("Every week", "Your church online") give 11 peers some structure without extra depth.

**Mobile bottom bar** (5 items, 48px+, 12px+ labels):
- **Home**
- **People**
- **Check-in** (or Attendance if Check-in is off)
- **Live** (if enabled; otherwise Announcements)
- **More** (a full-height sheet listing every section, plus Help, Settings and Sign out)

**Topbar:** page title (matching the sidebar label) and a **Help** button, instead of "DASHBOARD / {church}".

**Section tabs budget:** at most 4 visible tabs per section. Settings, Website and Groups get restructured as in §4.

---

## 7. Terminology changes

| Current (where) | Proposed |
|---|---|
| Live Stream / Broadcast tab | **Live** / **Go live** |
| Recordings + Library (Live) | **Recordings** (one view) |
| Library (PDF reports) / "Media & Documents" / "Documents" | **Reports** |
| Sermon Builder | **Sermons** |
| Call Log / Voice Assistant | **Phone Calls** |
| Member App / Faithful app / FaithForm app | **App** (nav); "the **Faithful** app" everywhere else (pick one name) |
| Households | **Families** |
| Guardian / Dependent / Household member | **Parent or guardian** / **Child** / **Other family member** |
| credential, "Credential valid", pickup credential | **Pickup code**, "Code is correct" |
| Override…, "Needs an override", Staff override | **Release without a code** (reason required) |
| "Pre-checked in, not yet received" | **On the way**: *Mark arrived* |
| Events / Events & services / Services board | **Services** |
| Automatic Attendance | **Phone check-in** (under Attendance › Setup) |
| Refresh from schedule | (remove; do it automatically) |
| Check-in area radius, m, lat/long | (infer; under Advanced: "How close counts as 'here'") |
| Verify & submit / Submitted / Verified / Published / Unsubmit | **Post** / **Posted** / **Take down**; **Draft · Scheduled · Posted** |
| Shared to FB? | **Also post on Facebook** |
| "SM posts", "PowerPoints created" | **Social posts**, **Slide decks** |
| Your Weekly Inputs | **Quick actions** (or no heading) |
| Integrations | **Connected accounts** |
| Save slug / URL slug | **Web address** |
| Payouts / "Payouts enabled" | **Deposits to your bank** / "Deposits are on" |
| Net / YTD / Disputed / In_transit / Past_due | **After fees** / **This year** / **Questioned by the donor's bank** / **On the way** / **Payment failed** |
| EIN (Tax ID) | **Tax ID (EIN)** |
| Hero / Eyebrow / Custom block / #about | **Banner** / **Small heading above** / **Text block** / "Link to a section" (picker) |
| DNS verified / Waiting on DNS | **Connected** / **Waiting for your domain company** |
| Server URL / Stream key / RTMP / encoder / relay | Under "Technical details" only; default copy says **streaming software** |
| Score (AI rubric) / Re-score / Retell | Hidden from churches; show **Needs a call back** / **Handled** |
| Magic link | **Email me a sign-in link** |
| Viewer / Member / Manager (roles) | **Team member** / **Admin**; group roles: **Member** / **Leader** |
| Gatherings | **Meetings** |
| Group slogans as headings | Page names: **Groups**, **Group messages**, **Join requests**, **Reports**, **Safety**, **Group settings** |
| "No church linked" | "Your account isn't connected to a church yet": **Set up your church** / **Ask your admin for an invite** |

---

## 8. Reusable component recommendations

| # | Component / helper | Replaces | Notes |
|---|---|---|---|
| 8.1 | **`toUserError()` + `ActionResult<T>`** (`lib/errors/`) | ~45 raw `error.message` returns, "Failed", HTTP codes | Generalize Groups' `runStaffAction` (`lib/groups/staff/context.ts:89`). Known error classes pass through; everything else gets the friendly fallback, with server-side logging. Add an ESLint rule banning `error.message` in `actions.ts` returns. |
| 8.2 | **`<ConfirmDialog>`** | `window.confirm`, `window.prompt`, ad-hoc dialogs | Props: `title`, `consequence`, `confirmLabel` (verb + object), `destructive`, optional `typeToConfirm`. |
| 8.3 | **`undoToast()`** | nothing today | Optimistic action plus an 8–10s Undo; the server action takes a reverse op. Use first for: remove from group or family, move room, archive, hide section, check-in void, release. |
| 8.4 | **`<StatusBadge domain="recording" state=…>`** + canonical vocabularies | raw enums, drifting labels | See §8.4 below. |
| 8.5 | **`<EmptyState icon title description action>`** | ad-hoc strings | Promote from `components/groups/shared.tsx`. |
| 8.6 | **`<PageHeader title description primaryAction>`** | slogans, multiple primaries | Enforces one primary; the title matches the nav label. |
| 8.7 | **`<ActionTile>` + `<NeedsYouCard>` + `<SetupChecklist>`** | Home tiles | Launchpad building blocks. |
| 8.8 | **`<PersonPicker multiple>`** | unsearchable `<select>` of all members, add-people modal | Type-ahead with recent people, selected chips, keyboard support. |
| 8.9 | **`useAutosave` + `<SaveStatus>`** (promote from `components/website-admin/use-autosave.ts`) and **`<UnsavedChangesBar>`** (promote from `church-info-editor.tsx`) | lost work | One of the two is required for every editor. |
| 8.10 | **`<SuccessPanel what where next>`** | tiny toasts for big moments | Check-in, release, send, publish, statements. |
| 8.11 | **`<MoreOptions>` disclosure** | nested `<details>`, errors inside collapsed sections | Auto-opens when it contains an error. |
| 8.12 | **`<SectionErrorBoundary>`** (`error.tsx` per section + root + `not-found.tsx`) | the Next default error page | Plain message, Try again, Go home, Contact support. |
| 8.13 | **`<Composer who what when>`** | Announcements verify form, follow-up send, group chat entry | One mental model for anything that reaches people, with reach count, preview and confirm. |
| 8.14 | Button primitive update | contrast, 40px `sm` | Default = navy background with white text, or gold background with navy text. `sm` → 44px; `xs`/`icon-xs` only for dense data tables. Switch → 32px tall with a larger hit area. |
| 8.15 | Groups kit migration | `groups.css` | Move to tokens and `components/ui`; drop 9–11px sizes. |

### 8.4 Canonical status vocabularies

- **Live:** Ready · Waiting for video · Live · Ended
- **Recording:** Processing · Ready to publish · Published *(in the app / on the website, listed explicitly)* · Not published · Problem
- **Announcement:** Draft · Scheduled · Posted · Taken down
- **Sermon:** Draft · Published in the app
- **Service:** Upcoming · Check-in open · Done · Cancelled
- **Attendance day:** Not started · In progress (draft) · Saved
- **Child:** On the way · Checked in · Picked up
- **Gift:** Received · Pending · Refunded · Questioned · Failed
- **Recurring gift:** Active · Paused · Payment failed · Cancelled
- **Deposit:** On the way · Deposited · Failed
- **Website:** Draft · Live · Changes not published (n)
- **Call:** Needs a call back · Handled

---

## 9. Five-second and no-training tests (Phases 13–14)

| Screen | 5-second test today | Needs training today? | Main blocker |
|---|---|---|---|
| Home | ✗ ("What is 0 hrs? What do I do?") | No, but no guidance | metrics first, no next step |
| Sidebar (desktop) | ✗ (unlabelled icons) | Yes ("hover the icons") | hover-only labels |
| People list | ✓ | No | (reconciliation panels push the list down) |
| Person panel | ~ | No | 4 tabs, 3 save models |
| Families | ✗ | Yes | pickup terms, unsearchable select, Guardian default |
| Groups list | ✗ ("Better together." — what page is this?) | No | slogans, 6 tabs, hero |
| Create group | ✗ | No, but slow | 18 fields, then a second trip to add people |
| Weekly attendance | ✓ | No | (no headcount, no edit) |
| Services board | ✗ | Yes | naming, "Refresh from schedule", roster below the fold |
| Attendance setup | ✗ | Yes | geofence map first |
| Kids check-in (Today) | ~ | **Yes** (visitors, codes) | new family impossible, no code at check-in |
| Checkout | ~ | **Yes** | codes the parent never received; "credential"/"override" |
| Live: Broadcast | ~ | No for go-live | schedule form and linker compete |
| Live: Setup | ✗ | **Yes** | encoder jargon, npm pairing |
| Recordings / Library | ✗ | Yes | Library has no status; "Published" ambiguous |
| Announcements | ✗ | **Yes** ("it has to be a calendar event") | calendar-only model, 4 state names |
| Sermon builder | ~ | Yes ("save = download") | forced download, no present |
| Call log | ✗ | Yes (what is Score?) | bot score; can't call back |
| Giving overview | ✗ | Yes | app-publishing panel first, no "this week" |
| Giving setup | ✗ | **Yes** | Stripe language, split across Settings |
| Statements | ✗ | **Yes** | wrong year, ZIP only |
| Website overview / Pages | ~ | Yes (Hero, Eyebrow; edits are live) | jargon, no draft |
| Website Domain | ✗ | **Yes** | DNS table |
| Member App | ✓ | No | (campus lat/long) |
| Settings | ✗ | Yes | grab-bag General, no church info, 6 tabs |
| Support | ~ | No | hidden on mobile, required Subject |

---

## 10. Prioritized implementation plan (Phase 15)

Each phase can ship independently, most-contained work first. Mobile apps are untouched throughout.

### Phase 0: Safety and correctness (days; do before any redesign)
1. **Household relationship: no default.** Add a disabled "Choose…" first option, and make the server reject a missing relationship. Labels become "Parent or guardian / Child / Other family member".
2. **Statements year picker.** Default to the previous year before 1 April, and pass `year` to the API.
3. **Atomic attendance save** (RPC or transaction) plus the ability to **edit a submitted Sunday**. Replace raw errors.
4. **Void a kids check-in** (with Undo) and a **"Receive" button** for pre-checked children.
5. **Follow-up texts:** show the exact message, allow editing, then confirm with "Text 12 people".
6. **Confirm dialogs** for:
   - revoke pickup
   - replace pickup codes
   - delete room
   - cancel service
   - mark everyone present
   - remove family member
   - delete document
   - delete sermon (website)
   - reset section
   - unpublish website
   - remove fund
   - cancel scheduled stream
7. Remove developer text from the UI: `pnpm …`, "on this database", "Stripe is not configured", "Forbidden".
8. Onboarding: remove `|| true`. Sermon series link: pass `series` and `scripture`. Announcement unsubmit copy: say it's removed from the app.
9. **Primary button contrast:** gold with navy text, or a navy primary.
10. Raw enum labels in Giving (payout, recurring, gift status, "dayly").

### Phase 1: Foundations (1–2 weeks)
- §8.1 `toUserError` + ActionResult, and an ESLint guard. Sweep all `actions.ts` files.
- §8.2 ConfirmDialog, §8.3 undo toast, §8.5 EmptyState, §8.4 StatusBadge vocabularies, §8.12 error boundaries (every section plus root plus not-found).
- Size floors: `size="sm"` → 44px; replace raw `<button>`s in core flows; text floor (no 9–11px; `text-xs` only for non-decision metadata).
- Fix "failed load looks empty" (payouts, service board).
- Skeleton parity fixes (22 routes) per `CLAUDE.md`.

### Phase 2: Navigation and Home (1–2 weeks)
- Labelled sidebar with grouping and a visible collapse toggle. Mobile 5-tab bar with **More** (Settings and Help reachable).
- Topbar with page title and **Help**. Support becomes a Help panel (FAQ, "Send us a message" with page context, email or phone).
- Home launchpad: "Needs you", task tiles, setup checklist, fewer and explained metrics.
- `/login` "Start a new church". Time zone inferred at setup.
- The terminology pass (§7) across nav, headings and buttons.

### Phase 3: Workflow rebuilds (ordered by user impact × frequency)
1. **Kids Check-in desk:** family check-in, new family, pickup code on success, fast release, Undo.
2. **Announcements composer:** Who, What, When, Where; schedule app posts; calendar as suggestions; 3 states.
3. **Live simplification:** one state card, recordings pipeline, "ready to publish" persistence, merge Recordings and Library, setup wizard, "Published in app vs website" clarity.
4. **Attendance:** headcount mode, any service day, drafts, one "Services" concept, setup checklist with map optional.
5. **Church info single source** plus **My account**, and the Settings restructure (§4.11).
6. **People contact** (Call/Text/Email) and the **Message composer** for groups and people.
7. **Sermons:** autosave, in-browser Present, one "Publish to app", reachable Lesson and Social tabs, next-Sunday default.
8. **Phone Calls:** Needs-call-back queue, Mark handled, admin call-back (after a privacy decision), control-center-only scoring.
9. **Giving:** this-week view, donor detail, setup wizard, statements send flow, plain Stripe language, correct fee copy.
10. **Groups:** 2-step create with people, page-name headings, badges, tab consolidation, `groups.css` → tokens.
11. **Website:** draft and "Publish changes", tab consolidation (Overview · Pages · Details & look · Sermons · Inbox, Domain under Advanced), domain helper options.
12. **Team invite:** role presets, name field, emailed sign-in link instead of a temp password.

### Phase 4: Polish and guardrails
- Adopt the Simplicity Standard checklist in the PR template. Consider a lint step for banned words in JSX strings (RTMP, slug, credential, rubric, Retell…).
- Remove dead code: `quick-actions.tsx`, `media-list.tsx`, `announcement-verify-dialog.tsx`, `announcement-calendar-queue.tsx`.
- Hallway tests with 3–5 real pastors and volunteers on the top 6 tasks. Record time to first click and completion, and re-run after each Phase 3 item.

### Product decisions needed from you
1. **Call log:** should church admins see full caller numbers (privacy vs. usefulness)?
2. **Announcements:** decouple from the calendar entirely, or keep calendar events as one source among others?
3. **Website:** introduce a draft/publish model (recommended), or keep live autosave with undo?
4. **Group and person messaging:** add SMS/email delivery (cost, consent and A2P registration), or stay app-only and say so plainly?
5. **Kids check-in labels:** is label printing in scope (hardware), or is the on-screen and texted code enough?
6. **Weekly email:** allow FaithForm to send it directly, or keep draft-only?

---

## Appendix: verification notes
- ✔ items were re-read in source during this audit:
  - sidebar and mobile nav
  - statements year
  - non-atomic attendance save
  - missing check-in void
  - onboarding `|| true`
  - series link params
  - `pnpm` string in announcements
  - phone masking
  - household relationship default
  - button contrast (`#FFFFFF` on `#C5A059` = 2.46:1)
- Other file:line references come from the area audits and should be spot-checked when each item is picked up. Line numbers drift.
- The iOS and Android code was not read for findings and nothing outside `docs/ux/` was modified.
