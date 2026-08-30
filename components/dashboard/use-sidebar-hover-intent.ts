"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  SIDEBAR_CLOSE_DELAY_MS,
  SIDEBAR_OPEN_DELAY_MS,
} from "@/lib/dashboard/sidebar-layout";

type HoverIntentHandlers = {
  onPointerEnter: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onClickCapture: (event: MouseEvent) => void;
  onFocus: (event: FocusEvent) => void;
  onBlur: (event: FocusEvent) => void;
};

export type SidebarHoverIntent = {
  hovering: boolean;
  keyboardFocusWithin: boolean;
  touchOpen: boolean;
  /** Attach to the sidebar element — used to tell inside taps from outside ones. */
  sidebarRef: RefObject<HTMLElement | null>;
  /** Spread onto the sidebar element. */
  handlers: HoverIntentHandlers;
  /** Close immediately, skipping the close delay (e.g. Escape, or after navigating). */
  close: () => void;
};

/**
 * Hover-intent for the sidebar: it opens for a pointer that *rests*, not one
 * that merely passes through, and closes on a deliberate exit rather than a
 * momentary one.
 *
 * Four things this is careful about:
 *
 *   * **Only a mouse hovers.** Touch also fires pointerenter, and on a
 *     touchscreen that enter never gets a matching leave — the panel would open
 *     on the first tap and stay open forever.
 *
 *   * **Touch gets a tap instead.** With the toggle button gone, a tablet wide
 *     enough to render the sidebar would otherwise be stuck with unlabelled
 *     icons. The first tap on the collapsed rail is swallowed and opens it; the
 *     next tap does what it looks like it does. Tapping outside closes it.
 *
 *   * **Focus is tracked separately from hover** and is never debounced.
 *     Tabbing is already a deliberate act; making a keyboard user wait 110ms to
 *     see where they are would be latency with no purpose.
 *
 *   * **Timers are always cancelled on unmount**, and a pending open is
 *     cancelled by a leave (and vice versa), so a fast in-out-in never leaves
 *     two timers racing to set opposite states.
 */
export function useSidebarHoverIntent(): SidebarHoverIntent {
  const [hovering, setHovering] = useState(false);
  const [keyboardFocusWithin, setKeyboardFocusWithin] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const lastPointerType = useRef<string>("mouse");
  const touchOpenRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const setTouch = useCallback((next: boolean) => {
    touchOpenRef.current = next;
    setTouchOpen(next);
  }, []);

  const schedule = useCallback(
    (next: boolean, delay: number) => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        setHovering(next);
      }, delay);
    },
    [clearTimer],
  );

  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      schedule(true, SIDEBAR_OPEN_DELAY_MS);
    },
    [schedule],
  );

  const onPointerLeave = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      schedule(false, SIDEBAR_CLOSE_DELAY_MS);
    },
    [schedule],
  );

  const onPointerDown = useCallback((event: PointerEvent) => {
    lastPointerType.current = event.pointerType;
  }, []);

  /**
   * Capture phase, so this runs before the link underneath sees the click. A
   * touch user tapping a collapsed rail is aiming at an icon they cannot read
   * yet, so the first tap reveals the labels instead of navigating on a guess.
   */
  const onClickCapture = useCallback(
    (event: MouseEvent) => {
      if (lastPointerType.current === "mouse") return;
      if (touchOpenRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setTouch(true);
    },
    [setTouch],
  );

  /**
   * React's onFocus/onBlur bubble, so these fire for any descendant — this is
   * focus-*within* without a listener per link.
   *
   * The `:focus-visible` test is what makes it usable with a mouse. Clicking a
   * nav link also focuses it, and counting that as "expanded" leaves the
   * sidebar open forever after every click: the pointer is long gone and the
   * labels are still sitting there. `:focus-visible` is the browser's own
   * answer to "did this focus come from the keyboard", so a click no longer
   * holds the panel open while hover alone governs the mouse.
   */
  const onFocus = useCallback((event: FocusEvent) => {
    const target = event.target as Element;
    if (typeof target.matches !== "function" || !target.matches(":focus-visible")) {
      return;
    }
    setKeyboardFocusWithin(true);
  }, []);

  const onBlur = useCallback((event: FocusEvent) => {
    // relatedTarget is where focus is going. If it is still inside the sidebar
    // the user is just moving between rows, and closing would be wrong.
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setKeyboardFocusWithin(false);
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setHovering(false);
    setKeyboardFocusWithin(false);
    setTouch(false);
  }, [clearTimer, setTouch]);

  // A tap-opened sidebar has no "leave" event to close it, so anything the user
  // touches outside the panel counts as one.
  useEffect(() => {
    if (!touchOpen) return;
    const onDocumentPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && sidebarRef.current?.contains(target)) return;
      setTouch(false);
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [touchOpen, setTouch]);

  return {
    hovering,
    keyboardFocusWithin,
    touchOpen,
    sidebarRef,
    handlers: {
      onPointerEnter,
      onPointerLeave,
      onPointerDown,
      onClickCapture,
      onFocus,
      onBlur,
    },
    close,
  };
}
