import "@/app/sites/site.css";

/**
 * Church sites deliberately do not inherit the dashboard shell. They are a
 * separate product surface with their own type system and their own tokens,
 * and pulling in the app chrome would fight both.
 *
 * Fonts load by <link> rather than next/font because the family names are
 * theme *data* -- they live in site_themes.tokens and can change without a
 * deploy. Pinning them at build time would move that decision back into code.
 * The list below is the union of the shipped themes' faces.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&display=swap"
      />
      {children}
    </>
  );
}
