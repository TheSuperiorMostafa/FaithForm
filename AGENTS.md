# FaithForm agent guidance

Shared project instructions for Codex and Claude Code. Keep project constraints here;
`CLAUDE.md` imports this file. Read linked documents only for the work they cover.

## Project and scope

- Web: Next.js App Router in `app/`, shared UI in `components/`, services in `lib/`.
- Native apps: `apps/faithform-ios` and `apps/faithform-android`. A web dashboard task does not imply native changes.
- Use pnpm. Commands and dependency versions in `package.json` are authoritative.

## Validation

Choose checks that cover the changed behaviour and its risk. Documentation-only changes
need no application build or test suite. No blanket requirement to add tests, use TDD,
run all checks, or perform a second review on every task. Broaden validation for shared
contracts, auth, payments, or database changes; follow the relevant release gates when
preparing a release. After relevant checks pass, repeat them only for a new change or
unresolved failure. Report what ran and any material limits briefly.

Available commands: `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
For focused TS tests: `pnpm exec tsx --test tests/unit/<file>.test.ts` (also `tests/security/`
and `tests/policies/`). Shared contract/token/localization changes use `pnpm verify:generated`.
Native checks: `pnpm ios:test` or `pnpm android:test` for the affected platform.
`pnpm ci:verify` is the comprehensive web gate, not a prerequisite for every edit.
Database and production scripts need a deliberately selected target; do not infer one from available credentials.

## Page loading: required for new or redesigned views

- Create a matching loading state for every new page, sub-route, or redesigned view. Async dashboard/admin routes need adjacent `loading.tsx` or a route-level Suspense fallback; independent async sections use section fallbacks.
- Match the destination geometry: shell/container width, grid columns and breakpoints, spacing, card padding, corners, borders, and header/action structure. A differently sized parent fallback is insufficient. Reserve dynamic content space to prevent layout shifts.
- Use `Skeleton`, `SkeletonContainer`, and `SkeletonText` from `@/components/ui/skeleton`. The root is `<SkeletonContainer label="Page/Section Name">`, providing status, busy state, loading announcement, and the 180ms delay followed by a 200ms fade-in.
- Shimmer uses `bg-muted` and the shared 1.6s gradient animation; preserve brand accents. No plain grey boxes or unstyled `animate-pulse`. Use `SkeletonText` for varied paragraph lengths with matching line height.
- Decorative placeholders are `aria-hidden`. Shimmer and fade-in respect reduced motion (`motion-reduce:animate-none`, `motion-reduce:before:animate-none`).
- Static titles, descriptions, breadcrumbs, buttons, notices, section/tab labels, table headers, and calendar weekdays render as real content. Only asynchronous data gets placeholders.
- Scroll owners (`html`, dashboard main, admin main) use `scrollbar-gutter: stable` with `@supports not (scrollbar-gutter: stable) { overflow-y: scroll; }` to prevent horizontal movement between loading and populated content.

## Web dashboard

For dashboard changes, use `docs/ux/DASHBOARD_UX_CHECKLIST.md`; full design rules are in
`docs/ux/DASHBOARD_SIMPLICITY_STANDARD.md`.

- The shell owns `max-w-6xl`; Announcements is the full-width exception. Page roots use `flex w-full flex-col`, with no separate `max-w-*`. Loading states use the same shell geometry.
- Reuse `PageHeader`, `ActionCard`, `List`/`ListRow`, `EmptyState`, `ErrorState`, `SuccessState`, `StatusBadge`, `AdvancedSection`, `SearchPicker`, `confirmAction`, `undoToast`, and `toUserError`.
- Plain church language, labelled visible actions, targets at least 44px. No hover-only/icon-only actions, raw error messages, `window.confirm`, or `window.prompt`.

## Safari: constrained dialogs and forms

Use shared `@/components/ui/dialog` primitives. In auto-height column layouts capped by
max-height, scroll bodies use `min-h-0 flex-auto overflow-y-auto`, not `flex-1`.
Intervening forms also need `flex min-h-0 flex-auto flex-col`. Headers, footers, and actions
use `shrink-0`; cap the dialog with a viewport value such as `max-h-[calc(100dvh-2rem)]`.
Assign a scroll owner that receives visible height before hiding outer overflow.
This rule does not apply to horizontal flex rows or explicitly sized shells.
For changes to this sizing chain, check short/long content, narrow screens, and short windows
in Safari/WebKit: fields must remain editable, the body must scroll, and actions stay reachable.
The reported Safari collapse was not reproduced locally; local WebKit checks do not establish
compatibility with the affected Safari version.

## Subagent delegation

Use subagents proactively for substantial independent work or context-heavy investigation;
keep small or tightly coupled tasks with the parent. Start with one or two, give compact
briefs and separate file ownership, and collect concise results. The parent owns shared
interfaces, integration, and proportionate validation; no automatic extra review or nested
fan-out. Preserve the selected model. See [delegation research](docs/agent-guidance-review.md#subagent-delegation)
for trade-offs and project examples.

## Project skills

Skills live in `.agents/skills/` with Claude links in `.claude/skills/`. Use the matching
skill only when its task applies; [the inventory](docs/agent-skills.md) records sources and
local adaptations. Project policy and pinned versions govern vendor references.
