"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw, Smartphone, SquareArrowOutUpRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { sitePreviewHref, sitePreviewPath } from "@/lib/sites/preview-navigation";
import { navigateSitePreview, previewFrameGeometry, previewLoadMessage } from "@/lib/sites/preview-frame";

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
  fillHeight = false,
  hiddenPage = false,
  onNavigate,
}: {
  previewUrl: string;
  className?: string;
  refreshToken?: unknown;
  sticky?: boolean;
  fillHeight?: boolean;
  hiddenPage?: boolean;
  /** Church-local path, so the page editor can follow preview navigation. */
  onNavigate?: (path: string) => boolean | void | Promise<boolean | void>;
}) {
  const localPreviewUrl = sitePreviewHref(previewUrl);
  const [frameUrl, setFrameUrl] = useState(localPreviewUrl);
  const [currentUrl, setCurrentUrl] = useState(localPreviewUrl);
  const currentUrlRef = useRef(localPreviewUrl);
  const [device, setDevice] = useState<Device>("desktop");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(620);
  const removeNavigation = useRef<(() => void) | null>(null);
  const navigating = useRef(false);
  const mounted = useRef(true);

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
    setLoadError(null);
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
    setLoadError(null);
  }, [localPreviewUrl]);

  const handleLoad = useCallback(() => {
    setLoading(false);
    removeNavigation.current?.();
    removeNavigation.current = null;
    try {
      const frame = frameRef.current;
      const doc = frame?.contentDocument;
      const href = frame?.contentWindow?.location.href;
      const message = previewLoadMessage({ readable:true, hasWebsite:Boolean(doc?.querySelector("[data-site]")), pathname:frame?.contentWindow?.location.pathname });
      setLoadError(message && hiddenPage && !frame?.contentWindow?.location.pathname.startsWith("/login")
        ? "This page is hidden from visitors. Turn on its main section in the editor to show it again."
        : message);
      if (message || !doc) return;
      if (href) {
        const path = sitePreviewPath(localPreviewUrl, href, window.location.origin);
        if (path !== null) {
          const next = sitePreviewHref(href);
          currentUrlRef.current = next;
          setCurrentUrl(next);
          onNavigate?.(path);
        }
      }
      // Pause page changes before the frame leaves the matching editor. A
      // rejected save keeps both on the same page, rather than showing one
      // page's preview beside another page's unsaved fields.
      const follow = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target;
        if (!target || !("closest" in target)) return;
        const anchor = (target as Element).closest<HTMLAnchorElement>("a[href]");
        if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
        const destination = new URL(anchor.href, href);
        const nextPath = sitePreviewPath(localPreviewUrl, destination.href, window.location.origin);
        if (nextPath === null || !onNavigate) return;
        if (destination.pathname === frame?.contentWindow?.location.pathname && destination.search === frame?.contentWindow?.location.search) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (navigating.current) return;
        navigating.current = true;
        void (async () => {
          try {
            await navigateSitePreview(nextPath, onNavigate, () => {
              const next = sitePreviewHref(destination.href);
              currentUrlRef.current = next;
              setCurrentUrl(next);
              setFrameUrl(next);
              setLoadError(null);
              setLoading(true);
            }, () => mounted.current && frameRef.current?.contentDocument === doc);
          } catch {
            // The editor keeps its draft and displays its own save feedback.
          } finally { navigating.current = false; }
        })();
      };
      doc.addEventListener("click", follow, true);
      removeNavigation.current = () => doc.removeEventListener("click", follow, true);
      wakeImages();
    } catch {
      setLoadError(previewLoadMessage({readable:false,hasWebsite:false}));
    }
  }, [localPreviewUrl, onNavigate, wakeImages, hiddenPage]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; removeNavigation.current?.(); };
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setLoadError("The preview is taking too long to load. Check your connection, then try again.");
    }, 20_000);
    return () => clearTimeout(timer);
  }, [loading, frameUrl, nonce, device]);

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
      setAvailableWidth(available);
      setFrameHeight(shell.clientHeight || 620);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [device, fillHeight]);

  const width = WIDTHS[device];
  const geometry = previewFrameGeometry(availableWidth, frameHeight, width);

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
                setLoadError(null);
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

        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" onClick={reload}>
            <RefreshCw
              className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")}
              aria-hidden
            />
            Refresh
          </Button>
          <a href={currentUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({variant:"ghost"})}>
              <SquareArrowOutUpRight className="size-4" aria-hidden />
              Open in new tab
          </a>
        </div>
      </div>

      <div
        ref={shellRef}
        className="relative overflow-hidden rounded-xl border border-border bg-muted/30"
        style={{ height: fillHeight ? "max(360px, calc(100dvh - 13rem))" : 620 }}
      >
        {loading ? (
          <SkeletonContainer label="Website preview" className="absolute inset-0 z-10 space-y-8 bg-card p-6">
            <div className="flex items-center justify-between gap-6"><Skeleton className="h-12 w-40"/><Skeleton className="h-11 w-24"/></div>
            <div className="space-y-4 py-10"><Skeleton className="h-10 w-3/4"/><Skeleton className="h-10 w-1/2"/><Skeleton className="h-5 w-4/5"/></div>
            <Skeleton className="h-48 w-full"/>
          </SkeletonContainer>
        ) : null}
        {loadError ? <div className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-card p-4"><ErrorState compact title={hiddenPage?"This page is hidden":"Preview unavailable"} description={loadError} onRetry={reload} retryLabel="Reload preview" className="w-full"/></div> : null}

        <iframe
          ref={frameRef}
          key={`${device}-${nonce}`}
          title="Website preview"
          src={frameUrl}
          onLoad={handleLoad}
          onError={() => { setLoading(false); setLoadError("The preview could not connect. Check your connection, then try again."); }}
          // Keep forms and interactive navigation working. This same-origin
          // sandbox constrains top-level navigation; trusted embed HTML must
          // still be protected by the server write path.
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          style={{
            width,
            position:"absolute",
            left:"50%",
            marginLeft:geometry.marginLeft,
            height: geometry.height,
            transform: `scale(${geometry.scale})`,
            transformOrigin: "top left",
            border: 0,
            background: "#fff",
          }}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        This shows your saved website. Changes appear here after they save.
      </p>
    </div>
  );
}
