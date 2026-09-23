---
name: skeleton-loading
description: Enforce pixel-accurate skeleton loading on all page designs and redesigns
trigger: always_on
---

# Skeleton Loading Standards

Whenever creating or modifying pages in this project:
1. Every async route segment must have a corresponding `loading.tsx` or `<Suspense>` fallback.
2. The skeleton must be pixel-accurate to the target page's layout:
   - Match the outer layout wrapper (`mx-auto max-w-* flex flex-col gap-*`).
   - Match all grid systems and responsiveness (`sm:grid-cols-2`, `md:grid-cols-3`, `xl:grid-cols-5`).
   - Match card styles (`rounded-xl`, `border-border`, `shadow-card`, header/content padding).
   - Match section headings (`border-l-4 border-accent pl-3 font-heading text-[26px] font-bold`).
3. Use `@/components/ui/skeleton` primitives (`Skeleton`, `SkeletonContainer`, `SkeletonText`).
4. **Anti-Flicker Threshold (150ms–200ms Grace Period)**: Always wrap loading states in `<SkeletonContainer label="...">` which applies an 180ms delay before dissolving in smoothly with `animation: skeleton-fade-in 200ms ease-out 180ms both`, preventing visual flashes on fast or cached navigations.
5. **Typography Metrics**: Use `<SkeletonText lines={n} />` for realistic multi-line paragraph placeholders with staggered line widths (e.g. 100%, 92%, 65%) and exact font leading.
6. Support accessibility: `role="status"`, `aria-busy="true"`, `aria-label="Loading..."`, and `<span className="sr-only">Loading...</span>` (handled automatically by `SkeletonContainer`), and support `motion-reduce:animate-none`.
7. **Scrollbar Gutter Stability**: Scroll containers (`html`, dashboard `<main>`, admin `<main>`) must enforce `scrollbar-gutter: stable` to eliminate horizontal layout shift (15px jitter) when transitioning between short skeleton views and long scrollable pages.
