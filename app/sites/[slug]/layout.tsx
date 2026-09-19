import "@/app/sites/site.css";
import "@/app/sites/themes/wood.css";
import "@/app/sites/themes/light.css";
import { SITE_FONTS_HREF } from "@/lib/sites/fonts";

/**
 * Church sites deliberately do not inherit the dashboard shell. They are a
 * separate product surface with their own type system and their own tokens,
 * and pulling in the app chrome would fight both.
 *
 * Fonts load by <link> rather than next/font because the family names are
 * theme *data* -- they live in site_themes.tokens and can change without a
 * deploy. Pinning them at build time would move that decision back into code.
 * `SITE_FONTS_HREF` is the union of the shipped themes' faces.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={SITE_FONTS_HREF} />
      {children}
    </>
  );
}
