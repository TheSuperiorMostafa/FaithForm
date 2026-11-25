---
name: faithform-whats-new
description: Use when a big user-facing FaithForm dashboard feature is finished, or when writing or editing a "What's new" release entry.
---

# FaithForm "What's new" announcements

Every finished big feature that church staff will notice gets an entry in the dashboard's
"What's new" pop-up. All content lives in `lib/releases/whats-new.ts`; adding an entry there is
the whole job. No database change, component change, or migration is needed.

## When to add an entry

Add one when the work you just finished is a **user-facing** change a pastor or church admin
would want to hear about: a new section, a new kind of thing they can make, a new alert, or a
change to something they use every week. Skip bug fixes, performance, refactors, admin-only
platform tools, native-app-only changes, and anything still behind a switch that is off for
every church. When unsure, add it; the user can remove it before release.

## How to add one

1. Open `lib/releases/whats-new.ts`. If the top release has not shipped yet (its `date` is today
   or later, or the user says it is still open), add your item to it. Otherwise add a new release
   at the **top** of `RELEASES`: `id: "update-<n>"`, `title: "Update <n>"`, `date` set to the
   release day (YYYY-MM-DD). Ask the user for the number if it isn't clear.
2. Item `id` is `<release id>/<short-slug>`, lowercase with dashes. Ids are stored per person once
   dismissed, so **never rename or reuse an id after it ships**.
3. Set `feature` to the switch in `lib/features/catalog.ts` that gates the feature: the key on
   the route's `<FeatureGate feature="...">` layout or its `guardFeature(...)` call. Use a list
   when it lives in several areas (shown if any one is on). Leave it out only when every church
   has it. Never invent a key.
4. Add `links` to where it can be tried, a dashboard path. With several features, give each link
   its own `feature`; the first one the person can open is shown.
5. Run `pnpm exec tsx --test tests/unit/whats-new.test.ts`. It checks ids, features, links,
   lengths and ordering.
6. To look at it, open `/dev-whats-new-preview` under `pnpm dev`: no sign-in, no database.
   `?features=people,website` shows what a church with only those features gets.

The pop-up shows each staff member the newest release from the last 60 days that still has items
for features they can open, once. Turning a feature on later makes its item appear while the
release is still recent. Platform admins visiting a church never see it.

## How to write an entry

Write for a 65-year-old pastor reading on a phone between services.

- **Title**: 3 to 7 words, benefit first. "Know the moment someone reaches out", not
  "Website inbox staff notifications".
- **Body**: one or two plain sentences, under 280 characters. Lead with what it does for the
  church, then the one detail that earns trust. Say "you" and "your church".
- **Link label**: verb first, names the result: "Build a lesson", "Turn on alerts". Never
  "Learn more" or "Click here".
- Use church words: people, members, events, lessons, sermons, connection cards. No vendor jargon,
  slugs, sync, RTMP, AI model names, or internal feature names. A familiar brand that helps people
  trust it (Google Maps) is fine.
- No exclamation marks, hype ("revolutionary", "supercharge"), or emoji. Be specific instead.
- One item per feature. Group small related changes into one item rather than listing each.

Good: title "Lessons from your pastor's sermon"; body "Build a Sunday School or Bible Study
lesson straight from the sermon, with a deep dive, discussion questions and the main points.";
link "Build a lesson".

Weak: title "New AI Lesson Builder feature!"; body "We've launched an exciting new tool that
leverages transcripts to generate content."

Follow project `AGENTS.md`. Do not change the pop-up's design or the `whats_new_reads` table for
an ordinary entry.
