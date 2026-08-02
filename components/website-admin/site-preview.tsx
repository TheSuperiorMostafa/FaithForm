"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw, Smartphone, SquareArrowOutUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
}: {
  previewUrl: string;
  className?: string;
  refreshToken?: unknown;
  sticky?: boolean;
}) {
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
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

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
              onClick={() => setDevice(key)}
              aria-pressed={device === key}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                device === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={reload}>
            <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
            <Button type="button" variant="ghost" size="sm">
              <SquareArrowOutUpRight className="mr-1 size-3.5" />
              Open
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
          src={previewUrl}
          onLoad={() => {
            setLoading(false);
            wakeImages();
          }}
          // The preview is our own page on our own origin, but it can carry
          // church-authored custom CSS and embeds — sandbox it so a bad embed
          // can't reach the dashboard around it.
          sandbox="allow-scripts allow-same-origin allow-popups"
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

      <p className="text-xs text-muted-foreground">
        This is your draft, exactly as a visitor would see it.
      </p>
    </div>
  );
}
