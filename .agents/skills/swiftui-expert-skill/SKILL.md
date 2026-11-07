---
name: swiftui-expert-skill
description: Use for SwiftUI state flow, layout, navigation, accessibility, or measured rendering performance in the native apps.
---

# SwiftUI reference

Respect each app's deployment target, Swift settings, architecture, and shared-token system.
No SDK upgrade, design rewrite, Liquid Glass adoption, or API migration is implied by this skill.
Check availability before using APIs described by the latest upstream reference.

Read the relevant topic only:
- State/data ownership: `references/state-management.md`, `references/environment-patterns.md`.
- View boundaries: `references/view-structure.md`, `references/performance-patterns.md`.
- Layout/lists: `references/layout-best-practices.md`, `references/list-patterns.md`.
- Navigation/sheets: `references/sheet-navigation-patterns.md`.
- Accessibility: `references/accessibility-patterns.md`.
- Animation: the matching `references/animation-*.md`.
- API changes: look up the specific API in `references/latest-apis.md`; do not migrate unrelated code.

Keep tokens in secure storage and network/business work out of view rendering. Preserve
native loading/error/empty states and platform behaviour. Performance changes need a concrete
invalidation, layout, or trace-based reason rather than blanket memoization or extraction.
Profiling scripts are available only for a profiling task; no automatic device capture.
`UPSTREAM.md` is the full vendor reference, not a required whole-file read.
