# Dashboard UX Checklist

Every new or changed **web dashboard** feature is reviewed against this list before it ships. It is the short form of [`DASHBOARD_SIMPLICITY_STANDARD.md`](./DASHBOARD_SIMPLICITY_STANDARD.md).

> If a feature requires ordinary pastors to read a manual, it is not finished.

## The eleven questions

| # | Question | "No" means |
|---|---|---|
| 1 | **Can a first-time user understand this?** Could a 65-year-old pastor say what the page does and what to do next within five seconds? | Rename, reorder, or cut until they can. |
| 2 | **Is there one obvious main action?** One solid button, named for its result, e.g. "Add person" or "Send to 18 people". | Demote the others to outline, ghost, or More options. |
| 3 | **Does every visible control need to be here?** | Move it behind `AdvancedSection`, or delete it. |
| 4 | **Can FaithForm make this decision automatically?** Infer it, remember it, or default it. | Add the default. Safety-critical choices (e.g. parent vs child) get **no** default. |
| 5 | **Is the terminology human?** No slug, RTMP, credential, sync, raw enums or vendor names. | Use the glossary in the audit (§7). |
| 6 | **Are important actions large and obvious?** Icon + label, targets ≥ 44px, nothing hover-only or hidden in a kebab menu. | Use `Button` default/lg sizes and `ListRow`. |
| 7 | **Is advanced functionality progressively disclosed?** One level deep, never two. | Use `AdvancedSection`. |
| 8 | **Is success obvious?** The toast or `SuccessState` names the thing and the result. | "Saved." is not enough. Say what was saved and where it went. |
| 9 | **Are errors understandable?** Every server action returns `toUserError(error, "We couldn't …")`. Failed loads use `ErrorState`, never an empty state. | No `error.message` reaches the page. |
| 10 | **Can mistakes be recovered?** Reversible actions use `undoToast`. Irreversible or wide-reach actions use `confirmAction` with a verb + object button. | Never a one-click delete, and never `window.confirm`. |
| 11 | **Would this require training?** | Simplify the flow, not the documentation. |

## Building blocks

| Need | Use |
|---|---|
| Page title + one primary action | `components/ui/page-header.tsx` → `PageHeader`, `SectionHeader` |
| Launchpad tiles | `components/ui/action-card.tsx` → `ActionCard`, `ActionGrid` |
| Lists instead of tables | `components/ui/list-row.tsx` → `List`, `ListRow`, `InitialsAvatar` |
| Nothing here yet | `components/ui/empty-state.tsx` → `EmptyState` |
| Something failed | `components/ui/error-state.tsx` → `ErrorState`; `app/**/error.tsx` → `SectionError` |
| It worked (big moments) | `components/ui/success-state.tsx` → `SuccessState` |
| State of a thing | `components/ui/status-badge.tsx` → `StatusBadge` (tones: ready, live, working, attention, done, neutral) |
| Rare options | `components/ui/advanced-section.tsx` → `AdvancedSection` |
| Choose people/families/groups | `components/ui/search-picker.tsx` → `SearchPicker` |
| Are you sure? (irreversible only) | `components/ui/confirm-dialog.tsx` → `confirmAction()` |
| Oops, undo | `lib/ui/undo-toast.ts` → `undoToast()` |
| Server errors in plain words | `lib/errors/user-error.ts` → `toUserError()`, `UserFacingError` |

## Layout rules

- The shell sets **one page width** (`max-w-6xl`) for every dashboard page. Announcements is the only exception, at full width. Page roots use `flex w-full flex-col` and never set their own `max-w-*`.
- Page rhythm: `PageHeader`, then optional section links (`SectionLinkTabs`, 4 at most), then content with `gap-8` between sections.
- Cards: `Card` (rounded-2xl) or `List` (rounded-3xl). Body text is 15–16px. `text-xs` is only for decorative metadata.
- Loading: a `loading.tsx` that mirrors the page pixel for pixel, inside `SkeletonContainer`. Static text (titles, descriptions, buttons, tab labels) renders as real text; only data shimmers.
