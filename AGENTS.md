# AI Development Guidelines & Protocols for FaithForm

## Mandatory Requirement: Pixel-Accurate Skeleton Loading

Whenever designing a new page, building a new sub-route, or redesigning an existing view in FaithForm, **you MUST ALWAYS create a matching skeleton loading state**. This is a non-negotiable architectural and design standard.

### Core Principles

1. **Geometric Parity & Zero Cumulative Layout Shift (CLS)**
   - Every page must have a dedicated Next.js App Router streaming fallback (`loading.tsx`), or route-level `<Suspense fallback={<...Skeleton />}>`.
   - Never rely on a generic or parent `loading.tsx` that has a different container width (`max-w-*`), grid structure, or layout flow.
   - The skeleton must pixel-accurately match the destination layout:
     - Same container constraints (`max-w-3xl`, `max-w-5xl`, `max-w-6xl`, `max-w-7xl`, `max-w-lg`, etc.).
     - Same grid columns and breakpoints (`sm:grid-cols-2`, `md:grid-cols-3`, `xl:grid-cols-5`, etc.).
     - Same card padding (`p-4`, `p-5`, `p-6`), rounded corners (`rounded-xl`, `rounded-2xl`, etc.), and borders (`border-border`).
     - Same header structure (title size, subtitle line, action buttons).
   - When real data loads, no UI elements should jump, stretch, or reflow.

2. **Visual Polish & Styling Standards**
   - Always use the shared `@/components/ui/skeleton` component.
   - Skeletons use `bg-muted` with the fluid shimmer highlight gradient (`before:animate-[shimmer_1.6s_infinite]`).
   - Match brand accents where appropriate (e.g., `border-t-[3px] border-t-accent` on stat cards, `border-l-4 border-accent` on section headers).
   - Never use raw jarring CSS animations like unstyled `animate-pulse` or plain grey boxes without shimmer.

3. **Accessibility (a11y) Requirements**
   - The root wrapper of every loading state must include:
     ```tsx
     <div role="status" aria-busy="true" aria-label="Loading [Page/Section Name]" className="...">
       ...
       <span className="sr-only">Loading [Page/Section Name]…</span>
     </div>
     ```
   - Individual decorative skeleton elements should have `aria-hidden="true"`.
   - Shimmer animations must support `motion-reduce:before:animate-none` for users who have requested reduced motion in their OS.

4. **Hierarchical Next.js Route Loading**
   - Next.js App Router automatically renders `loading.tsx` inside the nearest parent `layout.tsx`.
   - When creating a folder under `app/dashboard/...` or `app/admin/...`, create `loading.tsx` alongside `page.tsx` if the page fetches data asynchronously.
   - If a page has multiple independent async sections, wrap them in `<Suspense fallback={<SectionSkeleton />}>` with modular section skeletons.
