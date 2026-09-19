import "@/app/sites/site.css";
import "@/app/sites/themes/wood.css";
import "@/app/sites/themes/light.css";
import { SITE_FONTS_HREF } from "@/lib/sites/fonts";

/** Same stylesheet and fonts as a church site (app/sites/[slug]/layout.tsx). */
export default function DevSitePreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={SITE_FONTS_HREF} />
      {children}
    </>
  );
}
