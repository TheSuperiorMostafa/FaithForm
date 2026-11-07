---
name: edge-to-edge
description: Use for FaithForm Android status/navigation bar overlap, keyboard insets, edge-to-edge layouts, or system-bar legibility bugs.
---

# Android edge-to-edge

For the affected Activity/Compose screen, read the matching inset/layout/IME examples in
`UPSTREAM.md`. Keep the current SDK and dependency configuration unless an upgrade was requested.
Its migration-wide SDK prerequisite is not permission to upgrade an established production app.
Use the existing Activity edge-to-edge setup and Compose inset ownership; avoid applying the same
system/IME padding twice. Preserve scrolling, gesture navigation, input visibility, and bar contrast.
Check the changed screen on relevant sizes and keyboard/navigation states when layout evidence
is needed. No scan-and-rewrite of every Activity for a local overlap bug.
