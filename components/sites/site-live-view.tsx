import { PublicWatchClient } from "@/components/live-streaming/public-watch-client";
import { ResilientImage } from "./resilient-image";

/**
 * The church website's own watch page (`/live`).
 *
 * Reuses the public player and chat from /live/<slug> so playback, view
 * counting ("website" source) and chat behave exactly as there, wrapped in the
 * site's theme instead of the app's. `.site-live-player` remaps the app colour
 * tokens the player uses onto the church's site tokens.
 */
export function SiteLiveView({
  slug,
  themeKey,
  tokens,
  churchName,
  logoUrl,
  homeHref,
}: {
  slug: string;
  themeKey: string;
  tokens: Record<string, string>;
  churchName: string;
  logoUrl: string | null;
  homeHref: string;
}) {
  return (
    <div className="site-page" data-theme={themeKey} data-layout="live" style={tokens as React.CSSProperties}>
      <div data-site={slug}>
        <nav className="site-nav site-nav-static" aria-label="Site">
          <div className="site-nav-inner">
            <a href={homeHref} className="site-nav-brand">
              {logoUrl ? <ResilientImage src={logoUrl} alt="" className="site-nav-logo" fallback="hide" /> : null}
              <div>
                <div className="site-nav-title">{churchName}</div>
              </div>
            </a>
            {/* Not in .site-nav-links: that row is hidden on phones in favour of the menu. */}
            <a href={homeHref} className="site-btn site-btn-outline site-live-home">
              <span aria-hidden>←</span> Back to website
            </a>
          </div>
        </nav>
        <main className="site-section site-surface-canvas site-live">
          <div className="site-live-player">
            <PublicWatchClient slug={slug} />
          </div>
        </main>
      </div>
    </div>
  );
}
