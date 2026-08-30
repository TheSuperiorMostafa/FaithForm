import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SIDEBAR_CLOSE_DELAY_MS,
  SIDEBAR_OPEN_DELAY_MS,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  resolveSidebarLayout,
} from "@/lib/dashboard/sidebar-layout";

const sidebar = readFileSync("components/dashboard/sidebar.tsx", "utf8");
const shell = readFileSync("components/dashboard/dashboard-shell.tsx", "utf8");
const dashboardLayout = readFileSync("app/dashboard/layout.tsx", "utf8");
const hoverIntent = readFileSync(
  "components/dashboard/use-sidebar-hover-intent.ts",
  "utf8",
);

const IDLE = { hovering: false, keyboardFocusWithin: false, touchOpen: false };

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test("sits as a narrow rail when nothing is asking it to open", () => {
  assert.deepEqual(resolveSidebarLayout(IDLE), {
    expanded: false,
    panelWidth: SIDEBAR_WIDTH_COLLAPSED,
    layoutWidth: SIDEBAR_WIDTH_COLLAPSED,
    overlaying: false,
  });
});

test("opens for hover, keyboard focus, and touch alike", () => {
  const byHover = resolveSidebarLayout({ ...IDLE, hovering: true });

  assert.equal(byHover.expanded, true);
  assert.equal(byHover.panelWidth, SIDEBAR_WIDTH_EXPANDED);
  assert.deepEqual(
    resolveSidebarLayout({ ...IDLE, keyboardFocusWithin: true }),
    byHover,
  );
  assert.deepEqual(resolveSidebarLayout({ ...IDLE, touchOpen: true }), byHover);
});

test("never reserves more than the rail, in any state", () => {
  // The whole point: page content must not move when a pointer wanders in.
  for (const hovering of [true, false]) {
    for (const keyboardFocusWithin of [true, false]) {
      for (const touchOpen of [true, false]) {
        const layout = resolveSidebarLayout({
          hovering,
          keyboardFocusWithin,
          touchOpen,
        });
        assert.equal(layout.layoutWidth, SIDEBAR_WIDTH_COLLAPSED);
        assert.ok(layout.layoutWidth <= layout.panelWidth);
      }
    }
  }
});

test("closes more slowly than it opens", () => {
  // Asymmetry is deliberate: a premature close moves a target the user is
  // reaching for, which costs more than a slightly late open.
  assert.ok(SIDEBAR_CLOSE_DELAY_MS > SIDEBAR_OPEN_DELAY_MS);
  assert.ok(SIDEBAR_OPEN_DELAY_MS > 50 && SIDEBAR_OPEN_DELAY_MS < 200);
  assert.ok(SIDEBAR_CLOSE_DELAY_MS < 500);
});

// ---------------------------------------------------------------------------
// The wiring that makes it automatic
// ---------------------------------------------------------------------------
//
// The sidebar used to expand from a chevron button and remember the choice in a
// cookie. These pin the replacement: nothing to click, nothing persisted, and a
// content column that stays put while the panel floats over it.

test("the sidebar expands from hover intent, not a toggle button", () => {
  assert.match(sidebar, /useSidebarHoverIntent\(\)/);
  assert.match(sidebar, /\{\.\.\.hoverIntent\.handlers\}/);
  assert.doesNotMatch(sidebar, /Expand sidebar|Collapse sidebar/);
  assert.doesNotMatch(sidebar, /Chevron(Left|Right)/);
  assert.doesNotMatch(sidebar, /onCollapsedChange/);
});

test("hover intent ignores non-mouse pointers and untangles click-focus", () => {
  // Touch fires pointerenter with no matching leave, and a click focuses what it
  // hits — either one, taken at face value, pins the panel open forever.
  assert.match(hoverIntent, /pointerType !== "mouse"/);
  assert.match(hoverIntent, /:focus-visible/);
});

test("a touch user can still reach the labels", () => {
  assert.match(hoverIntent, /onClickCapture/);
  assert.match(hoverIntent, /preventDefault\(\)/);
});

test("the content column always reserves exactly the rail", () => {
  assert.match(shell, new RegExp(`md:ml-\\[${SIDEBAR_WIDTH_COLLAPSED}px\\]`));
  assert.doesNotMatch(shell, /md:ml-64/);
  assert.doesNotMatch(shell, /transition-\[margin-left\]/);
});

test("the collapsed-state cookie is gone from both ends", () => {
  assert.doesNotMatch(shell, /sidebar:collapsed/);
  assert.doesNotMatch(shell, /initialCollapsed/);
  assert.doesNotMatch(dashboardLayout, /sidebar:collapsed/);
  assert.doesNotMatch(dashboardLayout, /initialCollapsed/);
});
