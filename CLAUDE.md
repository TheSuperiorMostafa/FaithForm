# Claude Code Instructions for FaithForm

## Core Architecture & Guidelines

### Mandatory Requirement: Pixel-Accurate Skeleton Loading
- When adding a new page or redesigning an existing view, ALWAYS build a pixel-accurate skeleton loading fallback (`loading.tsx` or `<Suspense fallback={<...Skeleton />}>`).
- Layout Stability (Zero CLS): Skeletons must strictly mirror the final container width (`max-w-3xl`, `max-w-5xl`, `max-w-6xl`, etc.), grid columns, card paddings, and header hierarchy.
- Use `@/components/ui/skeleton` primitives (`Skeleton`, `SkeletonContainer`, `SkeletonText`).
- Always wrap loading states in `<SkeletonContainer label="...">` to enforce the 180ms anti-flicker delay (suppressing flashing on sub-150ms cached loads) and provide accessible `role="status"`, `aria-busy="true"`, and screen-reader announcements.
- Use `<SkeletonText lines={n} />` for paragraph placeholders with organic varying line widths and font leading parity.
