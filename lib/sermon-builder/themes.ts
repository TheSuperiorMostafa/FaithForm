export type SlideTheme = {
  id: string;
  name: string;
  description: string;
  bg: string;
  bgCss: string;
  text: string;
  accent: string;
  fontHead: string;
  fontBody: string;
  italicRef?: boolean;
};

export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep navy with gold accents — dramatic and reverent",
    bg: "0E1428",
    bgCss: "#0E1428",
    text: "F8FAFC",
    accent: "C9A227",
    fontHead: "Georgia",
    fontBody: "Georgia",
    italicRef: true,
  },
  {
    id: "ivory",
    name: "Ivory Classic",
    description: "Warm cream with charcoal type — timeless and readable",
    bg: "FAF7F2",
    bgCss: "#FAF7F2",
    text: "1C1917",
    accent: "78716C",
    fontHead: "Georgia",
    fontBody: "Georgia",
  },
  {
    id: "sunrise",
    name: "Sunrise",
    description: "Soft coral gradient feel — warm and inviting",
    bg: "FFF1E6",
    bgCss: "linear-gradient(135deg, #FFF1E6 0%, #FFD6BA 100%)",
    text: "431407",
    accent: "C2410C",
    fontHead: "Calibri",
    fontBody: "Calibri",
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep green with sage text — calm and grounded",
    bg: "1A2E1A",
    bgCss: "#1A2E1A",
    text: "E8F0E8",
    accent: "86A87A",
    fontHead: "Calibri",
    fontBody: "Calibri",
  },
  {
    id: "cathedral",
    name: "Cathedral Stone",
    description: "Stone gray with burgundy accents — traditional",
    bg: "E8E4DF",
    bgCss: "#E8E4DF",
    text: "292524",
    accent: "7F1D1D",
    fontHead: "Times New Roman",
    fontBody: "Times New Roman",
    italicRef: true,
  },
  {
    id: "royal",
    name: "Royal Velvet",
    description: "Rich purple with silver type — bold and elegant",
    bg: "2D1B4E",
    bgCss: "#2D1B4E",
    text: "F1E8FF",
    accent: "C4B5FD",
    fontHead: "Georgia",
    fontBody: "Georgia",
    italicRef: true,
  },
];

export const DEFAULT_THEME_ID = "midnight";

export function getTheme(id: string | null | undefined): SlideTheme {
  return (
    SLIDE_THEMES.find((t) => t.id === id) ??
    SLIDE_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  );
}

export function isValidThemeId(id: string): boolean {
  return SLIDE_THEMES.some((t) => t.id === id);
}
