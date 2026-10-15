"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw, Smartphone, SquareArrowOutUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sitePreviewHref, sitePreviewPath } from "@/lib/sites/preview-navigation";

/**
 * Live preview of the church's own site, framed inside the dashboard.
 *
 * Always loads the `?preview=1` URL so a draft renders — the public URL 404s
 * until the site is published, which would make the preview useless exactly
 * when it is needed most.
 *
 * Mobile is a real viewport, not a CSS scale: the site's breakpoints have to be
 * what is being previewed. The frame is sized to 390px and visually scaled
 * down, so media queries see a phone.
 */

type Device = "desktop" | "mobile";

const WIDTHS: Record<Device, number> = { desktop: 1280, mobile: 390 };

export function SitePreview({
  previewUrl,
  className,
  /** Bumping this from a parent re-loads the frame after a save. */
  refreshToken,
  sticky = false,
  onNavigate,
}: {
  previewUrl: string;
  className?: string;
  refreshToken?: unknown;
  sticky?: boolean;
  /** Church-local path, so the page editor can follow preview navigation. */
  onNavigate?: (path: string) => void;
}) {
  const localPreviewUrl = sitePreviewHref(previewUrl);
  const [frameUrl, setFrameUrl] = useState(localPreviewUrl);
  const [currentUrl, setCurrentUrl] = useState(localPreviewUrl);
  const currentUrlRef = useRef(localPreviewUrl);
  const [device, setDevice] = useState<Device>("desktop");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(1);

  /**
   * Wake any lazy image inside the frame.
   *
   * The frame is transform-scaled, and intersection inside a scaled iframe is
   * unreliable — below-the-fold images can sit deferred forever, so a church
   * sees a preview with photos missing that are really there. A preview that
   * hides content defeats its own purpose, so this trades the (negligible, at
   * this scale) lazy-loading win for showing the truth. Same-origin, so no
   * change to the public site is needed.
   */
  const wakeImages = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("img[loading='lazy']").forEach((img) => {
      img.setAttribute("loading", "eager");
    });
  }, []);

  const reload = useCallback(() => {
    setFrameUrl(currentUrlRef.current);
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  // Selecting an editor page intentionally changes the destination. The local
  // route uses this deployment's renderer and signed-in preview permissions.
  useEffect(() => {
    if (currentUrlRef.current === localPreviewUrl) return;
    currentUrlRef.current = localPreviewUrl;
    setCurrentUrl(localPreviewUrl);
    setFrameUrl(localPreviewUrl);
    setLoading(true);
  }, [localPreviewUrl]);

  const handleLoad = useCallback(() => {
    setLoading(false);
    try {
      const href = frameRef.current?.contentWindow?.location.href;
      if (href) {
        const path = sitePreviewPath(localPreviewUrl, href, window.location.origin);
        if (path !== null) {
          const next = sitePreviewHref(href);
          currentUrlRef.current = next;
          setCurrentUrl(next);
          onNavigate?.(path);
        }
      }
      wakeImages();
    } catch {
      // A church's external link can leave our origin. Never read its content.
    }
  }, [localPreviewUrl, onNavigate, wakeImages]);

  // A save in the parent invalidates what's on screen. Skip the first run so
  // the frame isn't reloaded the moment it mounts.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    reload();
  }, [refreshToken, reload]);

  // Scale the fixed-width frame down to whatever space the pane actually has.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const measure = () => {
      const available = shell.clientWidth;
      setScale(available > 0 ? Math.min(1, available / WIDTHS[device]) : 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [device]);

  const width = WIDTHS[device];

  return (
    <div className={cn("flex flex-col gap-3", sticky && "lg:sticky lg:top-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {(
            [
              { key: "desktop" as const, label: "Desktop", Icon: Monitor },
              { key: "mobile" as const, label: "Phone", Icon: Smartphone },
            ]
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (device === key) return;
                setFrameUrl(currentUrlRef.current);
                setLoading(true);
                setDevice(key);
              }}
              aria-pressed={device === key}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors",
                device === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <Button type="button" variant="ghost" onClick={reload}>
            <RefreshCw
              className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")}
              aria-hidden
            />
            Refresh
          </Button>
          <a href={currentUrl} target="_blank" rel="noopener noreferrer">
            <Button type="button" variant="ghost">
              <SquareArrowOutUpRight className="size-4" aria-hidden />
              Open in new tab
            </Button>
          </a>
        </div>
      </div>

      <div
        ref={shellRef}
        className="relative overflow-hidden rounded-xl border border-border bg-muted/30"
        style={{ height: 620 }}
      >
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
            Loading your website…
          </div>
        ) : null}

        <iframe
          ref={frameRef}
          key={`${device}-${nonce}`}
          title="Website preview"
          src={frameUrl}
          onLoad={handleLoad}
          // The preview is our own page on our own origin, but it can carry
          // church-authored custom CSS and embeds — sandbox it so a bad embed
          // can't reach the dashboard around it.
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          style={{
            width,
            height: 620 / scale,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: 0,
            background: "#fff",
          }}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Your website exactly as a visitor sees it.
      </p>
    </div>
  );
}
