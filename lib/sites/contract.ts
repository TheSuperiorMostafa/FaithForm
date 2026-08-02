import type { ComponentType } from "react";

import type { SiteProfile } from "@/types/site";

/**
 * The section master contract.
 *
 * The non-negotiable this file exists to enforce: a shared component never
 * knows which church it is rendering. Two rules make that structurally true
 * rather than a convention everyone has to remember.
 *
 * 1. A master receives `content` and nothing else of substance. No church_id,
 *    no slug, no database rows -- so there is nothing available to branch on
 *    even if someone wanted to.
 *
 * 2. Tokens are NOT props. They are CSS custom properties set on the page
 *    wrapper, so a component writes `var(--site-accent)` and physically cannot
 *    read which church's palette it resolved to. Passing a token map as a prop
 *    would reintroduce exactly the branching this design forbids.
 */

/**
 * Arrays are replaced wholesale by the resolver rather than merged element by
 * element, so they stay whole here instead of decomposing into partial items.
 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type SectionContext = {
  /** site_sections row id. Stable across renders; useful for React keys. */
  id: string;
  /** DOM id for in-page anchor links, e.g. "about". */
  anchor: string;
  /** Zero-based position in the resolved page. */
  index: number;
};

export type SectionComponentProps<TContent> = {
  content: TContent;
  ctx: SectionContext;
};

export type SectionMaster<TContent> = {
  /** Matches site_sections.type. */
  type: string;
  /**
   * Cascade level 1. Must be a complete, renderable content object -- a
   * section with no config at all still has to produce a sensible page.
   */
  defaults: TContent;
  /**
   * Cascade level 3. Pulls content out of the existing church profile
   * (service times, staff, address, mission). Returns only the keys it can
   * actually fill, so absent profile data falls through to the defaults.
   *
   * Returning an empty array here would *replace* the defaults with nothing and
   * render an empty section, so a derive with no data must omit the key.
   */
  derive?: (profile: SiteProfile) => DeepPartial<TContent>;
  Component: ComponentType<SectionComponentProps<TContent>>;
};

/**
 * Type-erased master, as stored in the registry.
 *
 * The registry is heterogeneous by nature -- every entry has a different
 * content type -- so the generic has to be discarded somewhere. Confining that
 * to `defineSection` below means each master stays fully typed where it is
 * authored, and the renderer only ever handles plain merged objects.
 */
export type ErasedSectionMaster = {
  type: string;
  defaults: Record<string, unknown>;
  derive?: (profile: SiteProfile) => Record<string, unknown>;
  Component: ComponentType<SectionComponentProps<Record<string, unknown>>>;
};

/** The single place the section content type is erased. */
export function defineSection<TContent extends object>(
  master: SectionMaster<TContent>,
): ErasedSectionMaster {
  return master as unknown as ErasedSectionMaster;
}

/** A section after the full cascade has run, ready to hand to the renderer. */
export type ResolvedSection = {
  type: string;
  content: Record<string, unknown>;
  ctx: SectionContext;
};

/** Everything a single page render needs, produced by the resolver. */
export type ResolvedPage = {
  slug: string;
  title: string;
  metaDescription: string | null;
  /** Flattened CSS custom properties for the page wrapper. */
  tokens: Record<string, string>;
  /** Sanitised per-church escape-hatch CSS, or null. */
  customCss: string | null;
  sections: ResolvedSection[];
};
