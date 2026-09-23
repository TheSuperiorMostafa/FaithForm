# Claude Code Instructions for FaithForm

## Core Architecture & Guidelines

### Mandatory Requirement: Pixel-Accurate Skeleton Loading
- When adding a new page or redesigning an existing view, ALWAYS build a pixel-accurate skeleton loading fallback (`loading.tsx` or `<Suspense fallback={<...Skeleton />}>`).
- Layout Stability (Zero CLS): Skeletons must strictly mirror the final container width (`max-w-3xl`, `max-w-5xl`, `max-w-6xl`, etc.), grid columns, card paddings, and header hierarchy.
- Use `@/components/ui/skeleton` with subtle shimmer animation.
- Always include accessible attributes: `role="status"`, `aria-busy="true"`, `aria-label="Loading [Section]"`, and `<span className="sr-only">Loading [Section]…</span>`.
