import type { SiteThemeDefinition } from "@/lib/sites/themes/types";

/**
 * The "Wood" format: dark walnut, parchment and aged gold, with Cinzel
 * headings, Karla body copy and Spectral as the softer editorial accent.
 */
export const woodTheme: SiteThemeDefinition = {
  key: "wood",
  name: "Wood",
  description:
    "Warm and traditional. Dark walnut, parchment and aged gold with stately Cinzel headings and softly rounded architectural details.",
  tokens: {
    "--site-ink": "#2B1A0C",
    "--site-ink-strong": "#170D06",
    "--site-ink-soft": "#4A362A",
    "--site-accent": "#C8961E",
    "--site-accent-ink": "#180F03",
    "--site-canvas": "#FBF6EC",
    "--site-canvas-alt": "#F3E8D2",
    "--site-gold": "#8A5B05",
    "--site-body": "#4A362A",
    "--site-muted": "#6B5342",
    "--site-muted-soft": "#89715D",
    "--site-surface": "#FFFDF8",
    "--site-font-display": "'Cinzel', Georgia, serif",
    "--site-font-body": "'Karla', system-ui, sans-serif",
    "--site-font-accent": "'Spectral', Georgia, serif",
    "--site-radius-card": "0px",
    "--site-radius-btn": "0px",
    "--site-radius-panel": "0px",
    "--site-section-y": "88px",
    "--site-section-x": "48px",
    "--site-display-xl": "62px",
    "--site-display-lg": "46px",
    "--site-display-md": "34px",
    "--site-heading-tracking": "0.02em",
    "--site-max-width": "1200px",
  },
  sectionDefaults: {
    site_nav: { sticky: true },
    hero: { surface: "ink", align: "center" },
    service_times: { surface: "canvas", columns: 3 },
    about_text: { surface: "canvas", align: "split" },
    vision_mission: { surface: "ink", align: "center" },
    staff_grid: { surface: "canvas", align: "center", columns: 3 },
    programs_grid: { surface: "canvas-alt", align: "center", columns: 4 },
    events_list: { surface: "canvas", align: "center" },
    visit_cta: { surface: "ink" },
    sermon_feed: { surface: "canvas", align: "split" },
    give_cta: { surface: "canvas-alt" },
    contact_band: { surface: "ink" },
    footer_map: { surface: "ink-strong" },
    custom_embed: { surface: "canvas" },
  },
};
