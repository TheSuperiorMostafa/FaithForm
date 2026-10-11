import "@/app/sites/site.css";
import "@/app/sites/themes/wood.css";
import "@/app/sites/themes/light.css";
import { getSiteBundle } from "@/lib/sites/queries";
import { resolveTokens } from "@/lib/sites/resolve";
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
export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getSiteBundle(slug, "/");
  const tokens = bundle ? resolveTokens(bundle.theme, bundle.settings, bundle.overrides.find((row) => row.scope === "church") ?? null) : {};
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={SITE_FONTS_HREF} />
      <div className="site-loading-context" data-theme={bundle?.theme.key} style={tokens as React.CSSProperties}>{children}</div>
    </>
  );
}
