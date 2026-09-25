# Claude Code Instructions for FaithForm

## Core Architecture & Guidelines

### Mandatory Requirement: Pixel-Accurate Skeleton Loading
- When adding a new page or redesigning an existing view, ALWAYS build a pixel-accurate skeleton loading fallback (`loading.tsx` or `<Suspense fallback={<...Skeleton />}>`).
- Layout Stability (Zero CLS): Skeletons must strictly mirror the final container width (`max-w-3xl`, `max-w-5xl`, `max-w-6xl`, etc.), grid columns, card paddings, and header hierarchy.
- Scrollbar Gutter Stability: Ensure main scroll containers (`html`, `dashboard-shell`'s `<main>`, and `admin/layout`'s `<main>`) enforce `scrollbar-gutter: stable` (and fallback `overflow-y: scroll`) so the viewport scrollbar space is reserved at all times, preventing a 15px horizontal shift when switching between skeleton and resolved content.
- Use `@/components/ui/skeleton` primitives (`Skeleton`, `SkeletonContainer`, `SkeletonText`).
- Always wrap loading states in `<SkeletonContainer label="...">` to enforce the 180ms anti-flicker delay (suppressing flashing on sub-150ms cached loads) and provide accessible `role="status"`, `aria-busy="true"`, and screen-reader announcements.
- Use `<SkeletonText lines={n} />` for paragraph placeholders with organic varying line widths and font leading parity.
- Static-First Principle (Text That Doesn't Change Loads Normally): Static text and UI chrome (page titles, descriptions, action buttons, section labels, table/calendar headers) must load as real text without skeleton shimmer. Skeletons should only mask dynamic, data-dependent values.

### Mandatory Requirement: Dashboard Simplicity Standard
- Every web dashboard change must pass `docs/ux/DASHBOARD_UX_CHECKLIST.md` (full rules in `docs/ux/DASHBOARD_SIMPLICITY_STANDARD.md`). If ordinary pastors would need a manual, it is not finished.
- One page width: the dashboard shell sets `max-w-6xl` for every page (Announcements is the only full-width exception). Page roots use `flex w-full flex-col` and never set their own `max-w-*`.
- Use the shared primitives (`PageHeader`, `ActionCard`, `List`/`ListRow`, `EmptyState`, `ErrorState`, `SuccessState`, `StatusBadge`, `AdvancedSection`, `SearchPicker`, `confirmAction`, `undoToast`, `toUserError`) instead of ad-hoc versions.
- Never return or render raw `error.message`; never use `window.confirm`/`window.prompt`; no icon-only or hover-only actions; targets ≥ 44px; plain church language (no slug, RTMP, credential, raw enums, vendor names).
- The iPhone and Android apps are separate; dashboard simplicity work never touches `apps/`.
