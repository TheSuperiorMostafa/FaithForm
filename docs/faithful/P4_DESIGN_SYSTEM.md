# Prompt 4 — The Faithful design system

Canonical source: `design/faithful/tokens.json` (v1.0.0) and
`design/faithful/components.json`. Native constants are **generated**, never
hand-written.

## Visual direction

Faithful should feel like a **place**, not a product dashboard.

- **Editorial hierarchy.** A screen leads with one confident idea. A serif
  display face (Fraunces) for headlines against a clean text face (Inter) is
  what separates this from generic management software.
- **Calm warm neutrals.** The background is `#F8F7F4`, a warm off-white, not
  clinical grey. Shadows are cast in brand navy at low opacity — a warm surface
  with a grey shadow reads as dirty.
- **One restrained accent.** Brand gold `#C5A059`, reserved for what the person
  should act on or notice. Used everywhere, it would mean nothing.
- **Generous spacing.** 20pt screen padding, 32pt between sections, 640pt max
  content width. Density is not a virtue in an app someone opens on a Sunday.
- **Deliberate depth.** Four elevation steps, each with a job. No glass stacks.
- **Accessible before decorative** — see below.

Explicitly rejected: cheap gradients, cluttered card grids, tiny type, and
borrowed social-feed layouts.

The brand navy/gold is inherited from FaithForm so the two products are visibly
related. The *layout language* is not: the dashboard is a work tool with dense
tables and a sidebar; Faithful is a visitor app with editorial spacing.

## Tokens

28 semantic colours per theme, 8 typography roles, 8 spacing steps, 6 radii,
3 border widths, 4 elevations, 5 motion durations. Semantic names only —
`contentSecondary`, never `gray600` — so a palette change does not require
renaming every use.

### Contrast is a build gate, not a review note

`scripts/generate-design-tokens.mjs` verifies **11 documented pairs across both
themes (22 checks)** against WCAG 2.1 and **exits non-zero on failure**.

This caught a real defect during implementation: white on brand gold is
**2.46:1**, well below the 3:1 floor. The fix was navy on gold at **5.55:1** —
more readable *and* more on-brand. The generator would not emit tokens until it
passed.

### Themes

Light and dark are both first-class. High contrast **raises border weight
(×1.5), promotes muted text to secondary, and drops decorative shadows** — it
changes emphasis, never hue, so the product still looks like itself.

### Type scaling

Body is 17pt with 26pt line height — comfortably above the 16pt floor. Both
platforms honour the system text size (Dynamic Type / `fontScale`) from 0.85×
to 2.0×. Layouts reflow; body text is never truncated and no touch target
clips at maximum scale.

### Motion

`instant` 0 · `fast` 120 · `standard` 220 · `slow` 320 · `deliberate` 480 ms.

Motion never delays a tap taking effect — feedback is immediate, animation is
decoration on top. Nothing loops except an explicit progress indicator.

**Reduced motion shortens a transition to 100 ms and disables parallax and
autoplay. It never removes the state change**, because the change carries the
meaning.

## Component states

25 primitives specified in `components.json`. Every interactive element declares
**rest, pressed, focused, disabled, loading**. Every control meets the touch
minimum (44pt iOS / 48dp Android; both satisfied by using 48) even when its
visual box is smaller.

Three states earn special rules:

- **Empty** says *why* it is empty and what would fill it. Never a bare
  illustration, never invented sample rows.
- **Offline** keeps cached content readable and labels it. **Never fabricates a
  result to fill a screen.**
- **Stale** shows an explicit age rather than presenting old content as current.

Colour never carries meaning alone; it is always paired with text, icon, or shape.

## Platform tolerances

These differences are **intentional and not parity defects**:

| Concern | iOS | Android |
|---|---|---|
| Back | Interactive swipe-back in `NavigationStack` | System back / predictive-back |
| Sheets | Detents | Material bottom sheet |
| Large title | Collapses on scroll | `TopAppBar` behaviour |
| Fonts | SF metrics | Roboto metrics |
| Ripple | None (opacity + scale) | Material ripple |
| Contrast signal | `legibilityWeight` | Explicit theme flag |

**What must match**: colour values, spacing, radii, type scale, elevation
opacity, motion duration, touch minimums, and the state matrix. Golden images
are compared per-platform against their own baselines, never across platforms —
comparing a SwiftUI render to a Compose render would only ever measure font
rasterisation.

## Generation and verification

```bash
pnpm design:generate   # writes Swift + Kotlin constants, runs the contrast audit
pnpm design:check      # verifies committed output is current; used by CI
```

Outputs:
- `apps/faithful-ios/Sources/FaithfulKit/Generated/DesignTokens.swift`
- `apps/faithful-android/core/design/src/main/kotlin/…/DesignTokens.kt`

Both are committed. `pnpm verify:generated` runs inside `pnpm ci:verify`, so a
token edit that skips regeneration **fails the build** rather than letting the
platforms drift. Editing a generated file has no effect beyond the next
regeneration, and both carry a header saying so.

A Swift test asserts `FaithfulTokens.version == "1.0.0"`; a mismatch means
someone hand-edited generated output instead of the source.

## Golden-image update policy

1. Goldens are **only** regenerated by an explicit command, never automatically
   on failure.
2. A diff must be reviewed as an image, not accepted from a pass/fail line.
3. The commit that updates a golden must say what changed and why.
4. A golden update that accompanies no token or component change is a
   regression until proven otherwise.
5. Baselines are per-platform, per-theme, at both default and maximum text scale.

**Status:** the policy and the token/state assertions are implemented and
green. Rendered golden-image capture requires a simulator and emulator and is
listed as pending device verification in
`P4_PARITY_AND_VERIFICATION_MATRIX.md`.
