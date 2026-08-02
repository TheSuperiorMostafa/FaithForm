/**
 * Content shapes for the public church website renderer.
 *
 * Every type here is the *resolved* contract a section master receives. By the
 * time a component sees one of these it holds no ids, no church_id and no
 * database rows -- just the copy and media it needs to draw. That is what keeps
 * the masters church-agnostic: there is nothing in the props to branch on.
 */

// ---------------------------------------------------------------------------
// PRIMITIVES
// ---------------------------------------------------------------------------

/** Named background/foreground pairing, resolved from theme tokens in CSS. */
export const SITE_SURFACES = [
  "ink",
  "ink-strong",
  "canvas",
  "canvas-alt",
  "accent",
  "surface",
] as const;
export type SiteSurface = (typeof SITE_SURFACES)[number];

/** Section header layout. `split` puts the sub-copy opposite the heading. */
export type SiteAlign = "split" | "center";

/**
 * A headline with an optional emphasised span in the middle, e.g.
 * "However you found your way here, we're *glad* you did." The accent renders
 * in the theme's serif italic face, so it must stay a separate field rather
 * than embedded markup.
 */
export type SiteHeadline = {
  lead: string;
  accent?: string;
  trail?: string;
};

/**
 * `src: null` renders the striped placeholder block from the mock with
 * `placeholder` as its caption, so a church without photos yet still gets a
 * page that reads as designed rather than as broken.
 */
export type SiteImage = {
  src: string | null;
  alt: string;
  placeholder?: string;
};

export type SiteLink = {
  label: string;
  href: string;
};

export type SiteAction = SiteLink & {
  variant?: "solid" | "outline" | "quiet";
};

// ---------------------------------------------------------------------------
// SECTION CONTENT
// ---------------------------------------------------------------------------

export type NavContent = {
  logo: SiteImage | null;
  title: string;
  subtitle: string | null;
  links: SiteLink[];
  cta: SiteAction | null;
  sticky: boolean;
};

export type HeroContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  body: string | null;
  actions: SiteAction[];
  image: SiteImage | null;
  surface: SiteSurface;
  align: SiteAlign;
};

/**
 * A cell carries either a `value` (large display text, e.g. a service time) or
 * `lines` (a small stacked block, e.g. the address). The mock's strip is three
 * of the former plus one of the latter.
 */
export type ServiceTimesCell = {
  label: string;
  value?: string | null;
  lines?: string[];
};

export type ServiceTimesContent = {
  items: ServiceTimesCell[];
  columns: number;
  surface: SiteSurface;
};

export type AboutTextContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  body: string[];
  stats: { value: string; label: string }[];
  image: SiteImage | null;
  surface: SiteSurface;
  align: SiteAlign;
};

export type VisionMissionContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  cards: { badge: string; title: string; body: string }[];
  surface: SiteSurface;
  align: SiteAlign;
};

export type StaffGridContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  note: string | null;
  members: {
    name: string;
    role: string | null;
    bio: string | null;
    photo: SiteImage | null;
  }[];
  columns: number;
  surface: SiteSurface;
  align: SiteAlign;
};

export type ProgramsGridContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  link: SiteLink | null;
  items: { badge: string; when: string; title: string; body: string }[];
  columns: number;
  surface: SiteSurface;
  align: SiteAlign;
};

export type EventsListContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  link: SiteLink | null;
  items: {
    title: string;
    date: string | null;
    location: string | null;
    note: string | null;
  }[];
  emptyMessage: string;
  surface: SiteSurface;
  align: SiteAlign;
};

/**
 * The Visit section carries the contact form. `form.enabled` is a content flag
 * rather than a separate section type so a church can turn it off without
 * losing the surrounding copy or reordering the page.
 */
export type VisitCtaContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  body: string | null;
  action: SiteAction | null;
  panelHeading: string;
  facts: { icon: string; title: string; body: string }[];
  form: {
    enabled: boolean;
    /**
     * Where the form posts. Resolved content, not a component decision -- the
     * component treats it as an opaque string exactly like GiveCta's `href`,
     * so it still has no way to branch on which church it is rendering.
     */
    endpoint: string;
    heading: string;
    description: string | null;
    submitLabel: string;
    successMessage: string;
    showPhone: boolean;
    showMessage: boolean;
    consentNote: string | null;
  };
  surface: SiteSurface;
};

export type SermonItem = {
  id: string;
  title: string;
  series: string | null;
  speaker: string | null;
  date: string | null;
  videoUrl: string | null;
  thumbnail: SiteImage | null;
};

export type SermonFeedContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  link: SiteLink | null;
  items: SermonItem[];
  emptyMessage: string;
  surface: SiteSurface;
  align: SiteAlign;
};

export type GiveCtaContent = {
  eyebrow: string | null;
  headline: SiteHeadline;
  body: string | null;
  bullets: string[];
  panelHeading: string;
  amounts: number[];
  otherLabel: string;
  /** Base giving URL; the picked amount is appended as a query param. */
  href: string;
  submitLabel: string;
  note: string | null;
  surface: SiteSurface;
};

export type FooterColumn = {
  heading: string;
  lines?: string[];
  links?: SiteLink[];
};

export type FooterMapContent = {
  logo: SiteImage | null;
  title: string;
  subtitle: string | null;
  blurb: string | null;
  /** Derived from the profile (service times). Overriding replaces it wholesale. */
  columns: FooterColumn[];
  /**
   * Configured columns, rendered after the derived ones. Separate because
   * arrays replace rather than merge: putting hand-authored links in `columns`
   * would silently drop the service times that track the dashboard.
   */
  extraColumns: FooterColumn[];
  copyright: string;
  map: {
    embedUrl: string | null;
    directionsUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
  } | null;
  surface: SiteSurface;
};

/**
 * Escape hatch. Renders unsanitised HTML, so writes are restricted to platform
 * admins at the RLS layer (see migration 0042).
 */
export type CustomEmbedContent = {
  html: string;
  surface: SiteSurface;
  contained: boolean;
};

// ---------------------------------------------------------------------------
// PROFILE  (the read model the resolver derives content from)
// ---------------------------------------------------------------------------

export type SiteProfileServiceTime = {
  label: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string | null;
  kind: string;
  notes: string | null;
};

export type SiteProfileStaff = {
  name: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
};

export type SiteProfileEvent = {
  title: string;
  date: string | null;
  location: string | null;
  note: string | null;
};

/**
 * Read-only projection of the existing church profile tables plus site_media.
 * Explicitly excludes stripe state, ai_knowledge and anything else that must
 * never reach a public page.
 */
export type SiteProfile = {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  missionStatement: string | null;
  visionStatement: string | null;
  denomination: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  googleMapsUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  livestreamUrl: string | null;
  serviceTimes: SiteProfileServiceTime[];
  staff: SiteProfileStaff[];
  events: SiteProfileEvent[];
  media: SermonItem[];
  givingEnabled: boolean;
};

// ---------------------------------------------------------------------------
// PAGE / CONFIG ROWS
// ---------------------------------------------------------------------------

export type SiteThemeRow = {
  key: string;
  name: string;
  tokens: Record<string, string>;
  sectionDefaults: Record<string, Record<string, unknown>>;
};

export type SiteSettingsRow = {
  themeKey: string;
  brandTokens: Record<string, string>;
  customCss: string | null;
  contactEmail: string | null;
  isPublished: boolean;
};

export type SiteSectionRow = {
  id: string;
  type: string;
  sortOrder: number;
  isVisible: boolean;
  props: Record<string, unknown>;
};

export type SiteOverrideRow = {
  scope: "church" | "page" | "section";
  pageId: string | null;
  sectionId: string | null;
  patch: Record<string, unknown>;
};

export type SitePageRow = {
  id: string;
  path: string;
  title: string | null;
  metaDescription: string | null;
  status: "draft" | "published";
};
