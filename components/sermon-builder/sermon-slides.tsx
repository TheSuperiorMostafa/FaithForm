"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  MonitorPlay,
  Pencil,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { getSermonSlidesAction } from "@/app/dashboard/sermon-builder/actions";
import { SlideView } from "@/components/sermon-builder/slide-view";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { PresentSlides } from "@/lib/sermon-builder/present-slides";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; slides: PresentSlides }
  | { status: "error"; message: string };

/**
 * Built slides, per sermon and version, so switching tabs does not look the
 * scripture up again. A saved edit changes `updated_at`, which is the version.
 */
const slidesCache = new Map<string, PresentSlides>();

/** Loads the deck once per version; Present and the preview share it. */
function useSermonSlides(sermonId: string, version: string) {
  const cacheKey = `${sermonId}:${version}`;
  const [state, setState] = useState<LoadState>(() => {
    const cached = slidesCache.get(cacheKey);
    return cached ? { status: "ready", slides: cached } : { status: "loading" };
  });
  const warned = useRef(false);

  const load = useCallback(async (force = false) => {
    const cached = slidesCache.get(cacheKey);
    if (cached && !force) {
      setState({ status: "ready", slides: cached });
      return;
    }
    setState({ status: "loading" });
    try {
      const result = await getSermonSlidesAction(sermonId);
      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }
      slidesCache.set(cacheKey, result.slides);
      setState({ status: "ready", slides: result.slides });
      if (result.slides.missing.length > 0 && !warned.current) {
        warned.current = true;
        toast.warning(
          `We couldn't look up ${result.slides.missing.join(", ")}, so it isn't in the slides. Check the reference in Edit sermon.`,
        );
      }
    } catch {
      setState({
        status: "error",
        message: "We couldn't load the slides. Check your internet connection and try again.",
      });
    }
  }, [sermonId, cacheKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: () => load(true) };
}

/**
 * The Slides tab: a preview of every slide, Present (full screen, in the
 * browser) as the main action, and Download PowerPoint for anyone who
 * presents from PowerPoint or ProPresenter.
 */
export function SermonSlides({
  sermonId,
  version,
  canEdit,
}: {
  sermonId: string;
  /** The sermon's `updated_at`: new slides are built after an edit. */
  version: string;
  /** Simple slide decks can be edited in the builder. */
  canEdit: boolean;
}) {
  const { state, reload } = useSermonSlides(sermonId, version);
  const [presentingFrom, setPresentingFrom] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const pages = state.status === "ready" ? state.slides.pages : [];
  const theme = state.status === "ready" ? state.slides.theme : null;

  const startPresenting = (from: number) => {
    // Full screen has to be asked for inside the click itself.
    try {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      // Not allowed here (an iframe, an older browser): present in the window.
    }
    setPresentingFrom(from);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          onClick={() => startPresenting(0)}
          disabled={state.status === "error"}
        >
          <MonitorPlay aria-hidden className="size-5" />
          Present
        </Button>
        <a
          href={`/api/sermon/${sermonId}/export/pptx`}
          download
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
        >
          <Download aria-hidden className="size-5" />
          Download PowerPoint
        </a>
        {canEdit && (
          <Link
            href={`/dashboard/sermon-builder/${sermonId}/edit`}
            className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
          >
            <Pencil aria-hidden className="size-5" />
            Edit slides
          </Link>
        )}
      </div>
      <p className="text-[15px] text-muted-foreground">
        Present shows the slides full screen. Use the arrow keys or click to
        move between slides, and press Esc to finish.
      </p>

      {state.status === "loading" && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading slides">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {state.status === "error" && (
        <ErrorState
          compact
          title="The slides didn't load"
          description={state.message}
          onRetry={() => void reload()}
        />
      )}

      {state.status === "ready" && pages.length > 0 && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => startPresenting(previewIndex)}
            className="overflow-hidden rounded-2xl border border-border shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Present from slide ${previewIndex + 1}`}
          >
            <SlideView page={pages[previewIndex] ?? pages[0]!} theme={theme} />
          </button>
          <p className="text-[15px] text-muted-foreground">
            {pages.length} slide{pages.length === 1 ? "" : "s"}. Choose one to
            see it larger.
          </p>
          <ol className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {pages.map((page, index) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => setPreviewIndex(index)}
                  aria-pressed={index === previewIndex}
                  aria-label={`Slide ${index + 1}`}
                  className={cn(
                    "block w-full overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    index === previewIndex ? "border-accent" : "border-border hover:border-accent/60",
                  )}
                >
                  <SlideView page={page} theme={theme} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {presentingFrom !== null && (
        <Presenter
          state={state}
          startAt={presentingFrom}
          onExit={(at) => {
            setPresentingFrom(null);
            setPreviewIndex(at);
          }}
          onRetry={() => void reload()}
        />
      )}
    </div>
  );
}

function Presenter({
  state,
  startAt,
  onExit,
  onRetry,
}: {
  state: LoadState;
  startAt: number;
  onExit: (at: number) => void;
  onRetry: () => void;
}) {
  const [index, setIndex] = useState(startAt);
  const pages = state.status === "ready" ? state.slides.pages : [];
  const theme = state.status === "ready" ? state.slides.theme : null;
  const count = pages.length;
  const indexRef = useRef(index);
  indexRef.current = index;
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  const exit = useCallback(() => {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
    exitRef.current(indexRef.current);
  }, []);

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, Math.max(count - 1, 0))), [count]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          event.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          event.preventDefault();
          prev();
          break;
        case "Home":
          event.preventDefault();
          setIndex(0);
          break;
        case "End":
          event.preventDefault();
          setIndex(Math.max(count - 1, 0));
          break;
        case "Escape":
          event.preventDefault();
          exit();
          break;
      }
    };
    // Esc in full screen is taken by the browser, which leaves full screen
    // without a key event; leaving full screen ends the presentation too.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) exitRef.current(indexRef.current);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.body.style.overflow = previousOverflow;
    };
  }, [next, prev, exit, count]);

  // Warm the next slide's background so it never flashes in.
  useEffect(() => {
    if (theme?.backgroundType === "image" && theme.imageUrl) {
      const img = new Image();
      img.src = theme.imageUrl;
    }
  }, [theme]);

  const page = pages[Math.min(index, Math.max(count - 1, 0))];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Presenting slides"
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
    >
      <div
        className="relative flex flex-1 items-center justify-center"
        onClick={() => page && next()}
      >
        {state.status === "loading" && (
          <p className="flex items-center gap-3 text-lg text-white/80">
            <Loader2 aria-hidden className="size-6 animate-spin motion-reduce:animate-none" />
            Getting your slides ready…
          </p>
        )}
        {state.status === "error" && (
          <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg">{state.message}</p>
            <div className="flex gap-3">
              <Button onClick={onRetry}>Try again</Button>
              <Button variant="outline" onClick={exit}>
                Close
              </Button>
            </div>
          </div>
        )}
        {state.status === "ready" && page && (
          <div className="w-[min(100vw,calc((100vh_-_4rem)*16/9))]">
            <SlideView page={page} theme={theme} />
          </div>
        )}
        {state.status === "ready" && !page && (
          <p className="text-lg text-white/80">This sermon has no slides yet.</p>
        )}
      </div>

      <div
        className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 text-white/70 transition-opacity hover:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={exit}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X aria-hidden className="size-5" />
          Exit (Esc)
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prev}
            disabled={index === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-medium hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronLeft aria-hidden className="size-5" />
            Previous
          </button>
          <span className="min-w-[4.5rem] text-center text-[15px] tabular-nums" aria-live="polite">
            {count > 0 ? `${Math.min(index, count - 1) + 1} / ${count}` : ""}
          </span>
          <button
            type="button"
            onClick={next}
            disabled={count === 0 || index >= count - 1}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-medium hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Next
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
