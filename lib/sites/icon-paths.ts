/** Public icon paths that must resolve to the hostname's church. */
export const CHURCH_ICON_SIZES = {
  "icon-32.png": 32,
  "icon-64.png": 64,
  "apple-180.png": 180,
} as const;

export const CHURCH_ICON_ALIASES: Readonly<Record<string, keyof typeof CHURCH_ICON_SIZES>> = {
  "/favicon.ico": "icon-64.png",
  "/favicon-32.png": "icon-32.png",
  "/favicon-64.png": "icon-64.png",
  "/apple-touch-icon.png": "apple-180.png",
  "/apple-touch-icon-precomposed.png": "apple-180.png",
};

export function isChurchIconRequest(pathname: string): boolean {
  return Object.hasOwn(CHURCH_ICON_ALIASES, pathname) || pathname.startsWith("/site-icons/");
}
