/**
 * Geometry and timing for the dashboard sidebar.
 *
 * On tablet widths the sidebar reserves a fixed 72px rail and never reserves
 * more than that. When it expands it draws wider than the space it occupies,
 * so it floats above the page instead of shoving it sideways — passing a
 * pointer over a rail should open a menu, not reflow a dashboard full of
 * tables and charts for a gesture the user may not even have meant.
 *
 * On large screens (≥1024px) the sidebar is simply open, labels always
 * visible: an older pastor should never have to discover that hovering a
 * column of icons reveals their names. It reserves its full width there, so
 * nothing floats over the page and nothing moves. The hover-to-open rail is
 * kept only for tablet widths, where a permanent 256px column would crowd
 * the page.
 *
 * These widths are mirrored by one Tailwind class in dashboard-shell.tsx
 * (`md:ml-[72px]`), because a media query cannot come from an inline style.
 * tests/unit/dashboard-sidebar.test.ts pins the two together.
 */

export const SIDEBAR_WIDTH_EXPANDED = 256;
export const SIDEBAR_WIDTH_COLLAPSED = 72;

/**
 * Pointer must rest this long before the sidebar opens. Short enough to feel
 * immediate when aimed at, long enough that a pointer travelling across the
 * rail to somewhere else does not drag the menu open behind it.
 */
export const SIDEBAR_OPEN_DELAY_MS = 110;

/**
 * And this long after leaving before it closes. Deliberately longer than the
 * open delay: the expensive mistake is closing on a pointer that was only
 * momentarily outside the panel — crossing a sub-pixel gap, or overshooting a
 * row — because the user then has to re-acquire a target that moved.
 */
export const SIDEBAR_CLOSE_DELAY_MS = 260;

export type SidebarInput = {
  /** Pointer is resting over the sidebar (already debounced by hover intent). */
  hovering: boolean;
  /**
   * Keyboard focus is inside the sidebar.
   *
   * Keyboard specifically — see use-sidebar-hover-intent. A mouse click also
   * focuses the thing it hits, and treating that as "expanded" pins the sidebar
   * open after every nav click: pointer long gone, labels still there.
   */
  keyboardFocusWithin: boolean;
  /**
   * A touch or pen user tapped the rail open. There is no hover on a
   * touchscreen, so without this the labels would be unreachable on a tablet
   * wide enough to render the sidebar at all.
   */
  touchOpen: boolean;
  /**
   * The viewport is wide enough to keep the sidebar open all the time
   * (≥1024px). Labels always show and the full width is reserved.
   */
  pinned?: boolean;
};

export type SidebarLayout = {
  /** Labels visible, panel at full width. */
  expanded: boolean;
  /** Width the sidebar draws at. */
  panelWidth: number;
  /** Width the sidebar reserves in the page layout — always the rail. */
  layoutWidth: number;
  /** Drawing wider than it reserves, i.e. floating above the content. */
  overlaying: boolean;
};

export function resolveSidebarLayout(input: SidebarInput): SidebarLayout {
  // Focus counts as much as hover. A sidebar that only opens for a pointer is
  // one a keyboard user tabs through blind — a column of unlabelled icons with
  // no way to widen it.
  if (input.pinned) {
    return {
      expanded: true,
      panelWidth: SIDEBAR_WIDTH_EXPANDED,
      layoutWidth: SIDEBAR_WIDTH_EXPANDED,
      overlaying: false,
    };
  }

  const expanded = input.hovering || input.keyboardFocusWithin || input.touchOpen;

  return {
    expanded,
    panelWidth: expanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED,
    layoutWidth: SIDEBAR_WIDTH_COLLAPSED,
    overlaying: expanded,
  };
}
