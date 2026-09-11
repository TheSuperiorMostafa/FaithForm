"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { SiteAction, SiteLink } from "@/types/site";

const ACTION_CLASS = {
  solid: "site-btn-solid",
  outline: "site-btn-outline",
  quiet: "site-btn-quiet",
} as const;

/**
 * The menu a phone gets.
 *
 * Above the breakpoint the links sit in the header, server-rendered and
 * crawlable. Below it they used to wrap into a block beside the church's name
 * and squeeze it into five lines; now a single button opens them as a column
 * of boxes big enough to tap. The links are in-page anchors, so tapping one
 * fires no navigation and the drawer has to close itself.
 */
export function SiteNavMenu({
  links,
  cta,
}: {
  links: SiteLink[];
  cta: SiteAction | null;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (links.length === 0 && !cta?.label) return null;

  const ctaVariant = ACTION_CLASS[cta?.variant ?? "solid"] ?? ACTION_CLASS.solid;

  return (
    <div className="site-nav-menu">
      <button
        type="button"
        className="site-nav-menu-btn"
        aria-expanded={open}
        aria-controls="site-nav-drawer"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
        <span className="site-nav-menu-label">Menu</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="site-nav-scrim"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <nav
            id="site-nav-drawer"
            className="site-nav-drawer"
            aria-label="Site menu"
          >
            {links.map((link) => (
              <a
                key={link.href + link.label}
                href={link.href}
                className="site-nav-drawer-link"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            {cta?.label ? (
              <a
                href={cta.href || "#"}
                className={cn("site-btn", ctaVariant, "site-nav-drawer-cta")}
                onClick={() => setOpen(false)}
              >
                {cta.label}
              </a>
            ) : null}
          </nav>
        </>
      ) : null}
    </div>
  );
}
