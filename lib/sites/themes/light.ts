import type { SiteThemeDefinition } from "@/lib/sites/themes/types";

/**
 * The "Light" format: a warm-white canvas, deep navy bands and a steel-blue
 * accent, with Cormorant Garamond display type over Manrope.
 *
 * Tokens carry the palette and type; app/sites/themes/light.css carries what
 * tokens cannot say (the transparent header over a full-bleed photo hero, the
 * frosted service-times card, pill buttons, photo cards). Two tokens mean
 * slightly more here than in other formats:
 *
 * - `--site-max-width` is the content measure inside full-bleed sections, not
 *   the width of a letterboxed column.
 * - `--site-gold` is a deeper steel than the accent, because the accent itself
 *   is too pale for small labels on the light canvas.
 *
 * Migration 0088 seeds exactly this; theme tests keep the two from drifting.
 * keeps the two from drifting.
 */
export const lightTheme: SiteThemeDefinition = {
  key: "light",
  name: "Light",
  description:
    "Airy and elegant. Warm white with deep navy bands, a steel-blue accent, pill buttons and Cormorant display type with italic accents.",
  tokens: {
    "--site-ink": "#062C40",
    "--site-ink-strong": "#04202F",
    "--site-ink-soft": "#15394D",
    "--site-accent": "#6FA3B5",
    "--site-accent-ink": "#062C40",
    "--site-canvas": "#FBFAF7",
    "--site-canvas-alt": "#F2F0EA",
    "--site-gold": "#3F7A8F",
    "--site-body": "#3D5563",
    "--site-muted": "#66757F",
    "--site-muted-soft": "#7A8790",
    "--site-surface": "#ffffff",
    "--site-font-display": "'Cormorant Garamond', Georgia, serif",
    "--site-font-body": "'Manrope', system-ui, sans-serif",
    "--site-font-accent": "'Cormorant Garamond', Georgia, serif",
    "--site-radius-card": "18px",
    "--site-radius-btn": "999px",
    "--site-radius-panel": "16px",
    "--site-section-y": "100px",
    "--site-section-x": "44px",
    "--site-display-xl": "70px",
    "--site-display-lg": "48px",
    "--site-display-md": "42px",
    "--site-heading-tracking": "0em",
    "--site-max-width": "1200px",
  },
  sectionDefaults: {
    site_nav: { sticky: true },
    hero: { surface: "ink", align: "split" },
    service_times: { surface: "surface", columns: 4 },
    about_text: { surface: "canvas", align: "split" },
    vision_mission: { surface: "canvas-alt", align: "center" },
    staff_grid: { surface: "canvas", align: "center", columns: 3 },
    programs_grid: { surface: "ink", align: "center", columns: 3 },
    events_list: { surface: "canvas", align: "center" },
    visit_cta: { surface: "canvas-alt" },
    sermon_feed: { surface: "canvas", align: "center" },
    give_cta: { surface: "canvas-alt" },
    contact_band: { surface: "canvas" },
    footer_map: { surface: "ink" },
    custom_embed: { surface: "canvas" },
  },
};
