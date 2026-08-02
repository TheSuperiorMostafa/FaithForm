import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type {
  SiteAction,
  SiteAlign,
  SiteHeadline,
  SiteImage,
  SiteLink,
  SiteSurface,
} from "@/types/site";

/**
 * Shared building blocks for the section masters.
 *
 * Nothing here takes a colour, a font or a church. Surfaces resolve to class
 * names whose custom properties are redefined per surface in site.css, so a
 * card placed on a dark section adapts without any component knowing it did.
 */

const SURFACE_CLASS: Record<SiteSurface, string> = {
  ink: "site-surface-ink",
  "ink-strong": "site-surface-ink-strong",
  canvas: "site-surface-canvas",
  "canvas-alt": "site-surface-canvas-alt",
  accent: "site-surface-accent",
  surface: "site-surface-surface",
};

export function surfaceClass(surface: SiteSurface | undefined): string {
  return SURFACE_CLASS[surface as SiteSurface] ?? SURFACE_CLASS.canvas;
}

export function SectionShell({
  surface,
  anchor,
  className,
  padded = true,
  children,
}: {
  surface: SiteSurface;
  anchor: string;
  className?: string;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={anchor}
      className={cn(surfaceClass(surface), padded && "site-section", className)}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return <div className="site-eyebrow">{children}</div>;
}

/**
 * The accent span renders in the theme's serif italic face. It stays a separate
 * field rather than inline markup so that copy stays plain text everywhere it
 * is edited, generated or translated.
 */
export function Headline({
  headline,
  className,
  as: Tag = "h2",
}: {
  headline: SiteHeadline;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag className={cn("site-display", className)}>
      {headline.lead}
      {headline.accent ? (
        <>
          {" "}
          <span className="site-accent-text">{headline.accent}</span>
        </>
      ) : null}
      {headline.trail ? <> {headline.trail}</> : null}
    </Tag>
  );
}

/**
 * Renders the image, or the mock's striped placeholder block when a church has
 * not supplied one yet. A missing photo should still leave a page that reads as
 * designed rather than a collapsed empty div.
 */
export function Media({
  image,
  className,
  wrapperClassName,
}: {
  image: SiteImage | null | undefined;
  className?: string;
  wrapperClassName?: string;
}) {
  if (!image) return null;

  if (!image.src) {
    return (
      <div
        className={cn("site-ph", className, wrapperClassName)}
        data-ph={image.placeholder ?? ""}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className={cn(className, wrapperClassName)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- src is an
          arbitrary church-supplied URL, so next/image remote patterns cannot
          enumerate it ahead of time. */}
      <img src={image.src} alt={image.alt} className="site-media" loading="lazy" />
    </div>
  );
}

const ACTION_CLASS = {
  solid: "site-btn-solid",
  outline: "site-btn-outline",
  quiet: "site-btn-quiet",
} as const;

export function Action({
  action,
  className,
}: {
  action: SiteAction | null | undefined;
  className?: string;
}) {
  if (!action?.label) return null;

  const variant = ACTION_CLASS[action.variant ?? "solid"] ?? ACTION_CLASS.solid;
  const external = /^https?:\/\//i.test(action.href);

  return (
    <a
      href={action.href || "#"}
      className={cn("site-btn", variant, className)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {action.label}
    </a>
  );
}

export function QuietLink({ link }: { link: SiteLink | null | undefined }) {
  if (!link?.label) return null;
  return (
    <a href={link.href || "#"} className="site-btn site-btn-quiet">
      {link.label}
    </a>
  );
}

/**
 * The section header. `split` puts the supporting note or link opposite the
 * heading (the mock's default); `center` stacks it, which is what the classic
 * theme uses. Both come from theme tokens, never from the component.
 */
export function SectionHead({
  eyebrow,
  headline,
  note,
  link,
  align,
  headingClassName = "site-display-md",
}: {
  eyebrow: string | null;
  headline: SiteHeadline;
  note?: string | null;
  link?: SiteLink | null;
  align: SiteAlign;
  headingClassName?: string;
}) {
  const aside = note ? <p className="site-head-note">{note}</p> : <QuietLink link={link} />;

  if (align === "center") {
    return (
      <div className="site-head site-head-center">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Headline headline={headline} className={headingClassName} />
        {aside}
      </div>
    );
  }

  return (
    <div className="site-head site-head-split">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Headline headline={headline} className={headingClassName} />
      </div>
      {aside}
    </div>
  );
}

/**
 * Column count for a grid, clamped to the number of items.
 *
 * The theme sets a column count for the look, but a church with three staff on
 * a four-column theme would otherwise render a visible empty cell. Clamping at
 * render keeps that correct no matter which cascade layer set `columns`.
 */
export function gridStyle(columns: number | undefined, itemCount?: number) {
  const requested = columns && columns > 0 ? columns : 3;
  const resolved =
    typeof itemCount === "number" && itemCount > 0
      ? Math.min(requested, itemCount)
      : requested;

  return { "--site-cols": String(resolved) } as React.CSSProperties;
}
