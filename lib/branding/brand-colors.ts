/** FaithForm's own navy and gold, used when a church hasn't chosen. */
export const DEFAULT_BRAND = { primary: "#002D5F", accent: "#C5A059" };

/** Shared by the color picker and its loading state. */
export const BRAND_SWATCHES: ReadonlyArray<{ name: string; primary: string; accent: string }> = [
  { name: "Navy and gold", primary: DEFAULT_BRAND.primary, accent: DEFAULT_BRAND.accent },
  { name: "Forest and wheat", primary: "#1F4D3A", accent: "#C9A227" },
  { name: "Burgundy and sand", primary: "#6B1E2E", accent: "#D4A373" },
  { name: "Royal and sky", primary: "#1E3A8A", accent: "#60A5FA" },
  { name: "Plum and honey", primary: "#4A2C6D", accent: "#E0B34C" },
  { name: "Charcoal and coral", primary: "#2B2D42", accent: "#EF8354" },
];
