# FaithForm Dashboard Simplicity Standard

**Scope:** the FaithForm **web dashboard** only (`app/dashboard/**`, `app/setup`, `app/login`, `app/onboarding`, `components/**` except `components/admin`). The iPhone and Android apps are out of scope.

**North star:** a pastor who dislikes technology opens FaithForm and immediately knows how to use it. Normal tasks should need no manual.

**Who we design for, in priority order:**
- **A.** A senior pastor, 65.
- **B.** A church administrator, 55.
- **C.** A volunteer, 68, often working a desk while people arrive.
- **D.** A younger staff administrator, 28. D must stay fast, but never at the cost of A–C seeing complexity they don't need.

NN/g testing puts users over 65 at 55% task success versus 75% for younger adults, with about twice the errors ([NN/g](https://www.nngroup.com/articles/usability-seniors-improvements/)). Design for A–C and D gets a fast tool as a side effect.

This standard is checked on every dashboard PR. Each rule has a **test** a reviewer can apply.

---

## 1. One obvious primary action

- Every page has **at most one** solid primary button. It names the page's main job, e.g. "Add person", "Go live", "Post announcement".
- Secondary actions use outline or ghost styling. Rare actions sit behind "More options", never in a kebab menu when they're common.
- Source: GOV.UK allows one primary button per page ([GOV.UK](https://design-system.service.gov.uk/components/button/)).
- **Test:** cover the page with your hand and uncover it for 1 second. Can you say what the one main button does?

## 2. Big, labelled, recognizable actions

- Actions pair an **icon with a text label**. No icon-only control for anything a normal user does (delete, edit, copy, send, move). Only home, search and print icons are close to universal ([NN/g icon usability](https://www.nngroup.com/articles/icon-usability/)).
- **Target size floor is 44px.** Primary actions and list rows are **48px or taller**, with 8px or more between targets. `size="sm"` (40px), `xs` (32px), 28px switches and 24px arrows aren't used for real actions.
- **Text size floor:**
  - Body text is 16px.
  - Secondary text is 14px or more (`text-sm`).
  - `text-xs` (12px) is allowed only for decorative metadata that doesn't affect a decision.
  - 9–11px text is never used.
- Meets WCAG 2.5.8 (24px minimum); we deliberately go above it ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).

## 3. Recognition over recall

- Users never need to remember IDs, codes, hex colours, slugs, coordinates, or "where the other setting was".
- Show recent and likely choices. Pickers for people are **searchable** and show selected people as visible chips.
- Information the user already gave is reused, never asked again (WCAG 3.3.7 Redundant Entry). **Church info is entered once** and used by the app, website, giving statements and attendance.
- The sidebar always shows **text labels**. It is never an icon-only rail that needs hovering.

## 4. Plain language

- Use the words a church uses. See the glossary in [`DASHBOARD_USABILITY_AUDIT.md` §7](./DASHBOARD_USABILITY_AUDIT.md#7-terminology-changes).
- **Banned in user-facing text** unless the user deliberately opened an "Advanced" or "Technical details" area:
  - Streaming: RTMP, SRT, ingest, encoder settings, bitrate, H.264, keyframe
  - Web: slug, DNS record types, CNAME, webhook, API, token, sync, provision, relay
  - Internal names: Integrations, rubric, credential, override, occurrence, tenant, database
  - Vendor names where the brand isn't the point: Retell, Stripe requirement keys, Twilio
  - Raw enum values: `past_due`, `in_transit`, `scheduled`, `draft`
- Buttons are **verb + object** and describe the result: "Send to 48 people", "Delete group", "Publish to app". Not "Save", "Submit", "Confirm", "OK" or "Manage".
- Headings **name the page** ("Groups", "Group messages"). They are not slogans like "Better together." or "A place to belong."
- Write at a 6th–8th grade reading level ([NN/g](https://www.nngroup.com/articles/writing-for-lower-literacy-users/)).

## 5. Progressive disclosure, at most two levels

- The default screen shows what **most churches need every week**. Everything else sits behind one clearly labelled "More options" or "Advanced" link ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).
- Never three levels deep. Never hide a field that has a validation error inside a collapsed section.
- Configuration never blocks first use. A feature works with defaults first; tuning comes later.

## 6. Smart defaults

For every field, ask: *does the user genuinely need to decide this?* If not, FaithForm should **infer** it, **remember** it, **default** it, or **drop** it. Examples:

| Infer from the address | Default |
|---|---|
| Time zone, latitude/longitude, check-in radius | Sermon date is next Sunday, not today |

- **Safety-critical choices have no default.** Example: "Is this person a parent/guardian or a child?"

## 7. Organize around what the church wants to do

- Navigation, page titles and flows follow church jobs: *Go live, Check kids in, Post an announcement, Send statements*. They do not follow system nouns like *Broadcast configuration, Occurrences, Integrations, Payouts*.
- One task, one place. If the same data is editable in two places, one becomes the source and the other shows it read-only with "Edit in Church info".

## 8. Always show where you are and what happened

- **Where am I?** The page title matches the sidebar label, and the active item is highlighted.
- **What can I do?** One primary action, visible without scrolling.
- **What should I do next?** Setup checklists, "Needs you" cards and next-step buttons after success.
- **What happened?** Every change gets feedback that names the object and the result:
  - "Maria added to Choir."
  - "Posted to the app. 214 people notified."
- Silent success and silent failure are both bugs.
- **Status labels come from one shared vocabulary per domain**; see [`DASHBOARD_USABILITY_AUDIT.md` §8.4](./DASHBOARD_USABILITY_AUDIT.md#84-canonical-status-vocabularies). The same state never has two names.

## 9. Forgiveness

- **Undo first, confirm second** ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)):
  - **Reversible actions** happen immediately and show an **Undo** toast for 8–10 seconds. Examples: remove from group, archive, move a child's room, hide a section.
  - **Irreversible or wide-reach actions** use a styled confirm dialog. Examples: send texts or push to many people, permanent delete, refund, replace pickup codes, take the website offline.
- **How to write a confirm dialog:**
  - State the consequence with specifics: "Text 12 people now?", "Refund $50 to John Smith?".
  - Use specific buttons ("Send 12 texts" / "Go back"), never Yes/No.
  - Make the destructive button red.
  - Never use `window.confirm` or `window.prompt`.
- **Editors never lose work.** Autosave with a visible "Saved" status, *or* a sticky unsaved-changes bar plus a leave guard. Long forms are never in a modal that closes when you click outside it.
- **Every page is safe to explore.** Opening a screen never changes anything.

## 10. Errors people can act on

- **Raw backend text never reaches the user.** That means Postgres/Supabase messages, Stripe or Twilio bodies, HTTP status codes, stack traces, and `pnpm …` commands.
- Every server action returns a **user-safe message** through the shared error helper. Unknown errors become "Something went wrong. Your changes weren't saved. Try again, or contact FaithForm support.", and details are logged server-side.
- Say what happened and how to fix it, next to the field. Keep what the user typed ([GOV.UK](https://design-system.service.gov.uk/components/error-message/)).
- A failed load is never shown as an empty state. "Couldn't load your payouts. Try again" is not the same as "No payouts yet".
- Every dashboard section has an `error.tsx` boundary with a plain message, a **Try again** button and a way home.

## 11. Empty, loading and success states

- **Empty:**
  - Say what the area is for, in one short line.
  - Add **one** create button, e.g. "No groups yet" + "Create your first group".
  - Never "No data".
- **Loading:** follows the pixel-accurate, static-first skeleton rule in `CLAUDE.md`.
- **Success:** for important outcomes (sent, published, checked in, released), use a clear panel or large toast that answers three things:
  - what happened,
  - where it went,
  - what to do next: **View · Undo · Done**.

## 12. Tables only when comparing

- Use a table only where people compare across rows, sort, or export. Examples: gifts, the giving export, attendance history.
- Everything else is **big rows or cards**: avatar/icon, name, one status and one obvious action. People, groups, recordings, calls and households all qualify.

## 13. Modern, calm, on-brand

- Consumer-grade simplicity with SaaS polish. Generous whitespace, strong type, restrained colour, simple cards, subtle motion, clear focus rings.
- Not legacy church software, not enterprise, not a government portal, not a children's app.
- **Colour contrast meets WCAG AA:** 4.5:1 for text, 3:1 for UI. White text on FaithForm gold (`#C5A059`) is **2.46:1 and is not allowed**. Use navy text on gold (5.55:1) or navy buttons.
- One design system: tokens from `globals.css`. No per-feature CSS with its own hex colours and font sizes (`groups.css` today).

---

## Review checklist (paste into PRs touching `app/dashboard` or `components`)

- [ ] **Five-second test:** could a 65-year-old pastor say what this page does and what to do next within five seconds?
- [ ] **No-training test:** could an ordinary church do this task without instructions?
- [ ] At most one primary button; it names the result.
- [ ] No icon-only actions; targets ≥ 44px; no text under 14px on decision-relevant content.
- [ ] No jargon, vendor names, raw enums or raw backend errors.
- [ ] Destructive actions: Undo if reversible, specific confirm if not.
- [ ] Empty, error, loading and success states are all designed.
- [ ] Editors can't silently lose work.
- [ ] Advanced options are behind one "More options", no deeper.
- [ ] Same state = same word as the rest of the product.
