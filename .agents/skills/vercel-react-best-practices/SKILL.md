---
name: vercel-react-best-practices
description: Improve React/Next.js waterfalls, rendering, data fetching, or bundle performance when the task involves those behaviours.
---

# React and Next.js performance

Apply the relevant Vercel rules to the changed path; do not run a whole-app optimization audit
for an ordinary component edit. Project `AGENTS.md` and installed React/Next.js versions govern.
Both projects use Next.js 15; Pivorta uses React 18 and FaithForm React 19. Version-specific
APIs need verification against the installed version. No dependency upgrade is implied.

Read individual files in `rules/` for the issue being addressed:
- Request waterfalls: `rules/async-parallel.md`, `rules/async-defer-await.md`, `rules/async-suspense-boundaries.md`.
- Bundle weight: `rules/bundle-barrel-imports.md`, `rules/bundle-dynamic-imports.md`.
- Server data: `rules/server-auth-actions.md`, `rules/server-cache-react.md`, `rules/server-parallel-fetching.md`.
- Rendering: search `rules/rerender-*` or `rules/rendering-*` for the affected pattern.

Tenant authorization and tenant-scoped cache keys remain mandatory. A cache optimization must
not share private data across callers. Preserve FaithForm's matching loading-state geometry.
Prefer an observed bottleneck or concrete dependency chain over speculative memoization.
Validate the affected interaction/performance when it matters; no automatic benchmark suite.
`UPSTREAM.md` and the compiled `AGENTS.md` are retained references, not startup reading.
