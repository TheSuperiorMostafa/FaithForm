"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type {
  PresentationPage,
  PresentationThemeSnapshot,
} from "@/lib/sermons/v1/presentation-manifest";
import {
  pickBodyFontSize,
  pickSubtitleFontSize,
  SLIDE_WIDTH_PT,
  TITLE_FONT_PT,
} from "@/lib/sermon-builder/slide-text-size";
import { cn } from "@/lib/utils";

/** FaithForm navy and gold, for a sermon with no slide theme. */
export const FALLBACK_SLIDE_THEME: PresentationThemeSnapshot = {
  id: "faithform",
  name: "FaithForm",
  backgroundType: "solid",
  bg: "002D5F",
  bgCss: "#002D5F",
  text: "FFFFFF",
  accent: "D4AF37",
  fontHead: "Georgia",
  fontBody: "Georgia",
  italicRef: false,
  textShadow: false,
  imageUrl: null,
};

function fontStack(name: string | null | undefined): string {
  return name ? `"${name}", Georgia, "Times New Roman", serif` : "Georgia, serif";
}

/**
 * One slide, drawn in HTML from the same page model the PowerPoint export and
 * the app use, in the deck's theme. Sizes are the export's point sizes scaled
 * to this box's width, and text that would overflow shrinks to fit, as the
 * export's "shrink on overflow" does.
 */
export function SlideView({
  page,
  theme: themeProp,
  className,
}: {
  page: PresentationPage;
  theme: PresentationThemeSnapshot | null;
  className?: string;
}) {
  const theme = themeProp ?? FALLBACK_SLIDE_THEME;
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fit, setFit] = useState(1);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Start from the export's size again whenever the slide or the box changes.
  useLayoutEffect(() => {
    setFit(1);
  }, [page.id, width]);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || width === 0) return;
    if (el.scrollHeight > el.clientHeight + 1 && fit > 0.35) {
      setFit((f) => f * 0.9);
    }
  }, [page.id, width, fit]);

  const pt = (size: number) => `${(size / SLIDE_WIDTH_PT) * width * fit}px`;
  const color = (hex: string) => `#${hex.replace(/^#/, "")}`;
  const shadow = theme.textShadow ? "0 2px 8px rgba(0,0,0,0.55)" : undefined;
  const background =
    theme.backgroundType === "image" && theme.imageUrl
      ? {
          backgroundImage: `url(${theme.imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundColor: theme.bg ? color(theme.bg) : "#0E1428",
        }
      : { background: theme.bgCss || (theme.bg ? color(theme.bg) : "#0E1428") };

  const isTitle = page.kind === "title";
  const isScripture = page.kind === "scripture";
  const body = page.body?.trim() ?? "";

  return (
    <div
      ref={boxRef}
      className={cn("relative aspect-video w-full overflow-hidden", className)}
      style={background}
    >
      {theme.backgroundType === "image" && theme.textShadow && (
        <div aria-hidden className="absolute inset-0 bg-black/25" />
      )}
      {width > 0 && (
        <div
          ref={textRef}
          className="absolute inset-x-[4%] inset-y-[7%] flex flex-col items-center justify-center overflow-hidden text-center"
          style={{ textShadow: shadow }}
        >
          {isTitle ? (
            <>
              <p
                className="font-bold leading-tight"
                style={{
                  color: color(theme.text),
                  fontFamily: fontStack(theme.fontHead),
                  fontSize: pt(TITLE_FONT_PT),
                }}
              >
                {page.title}
              </p>
              {body && (
                <p
                  className="mt-[3%]"
                  style={{
                    color: color(theme.accent),
                    fontFamily: fontStack(theme.fontHead),
                    fontSize: pt(pickSubtitleFontSize(body)),
                    fontStyle: theme.italicRef ? "italic" : undefined,
                  }}
                >
                  {body}
                </p>
              )}
            </>
          ) : isScripture ? (
            <p
              className="whitespace-pre-line"
              style={{
                color: color(theme.text),
                fontFamily: fontStack(theme.fontBody),
                fontSize: pt(pickBodyFontSize(body || page.scripture || "")),
                lineHeight: 1.15,
              }}
            >
              {body || page.scripture}
            </p>
          ) : (
            <>
              {page.title && (
                <p
                  className="font-bold leading-tight"
                  style={{
                    color: color(theme.accent),
                    fontFamily: fontStack(theme.fontHead),
                    fontSize: pt(36),
                  }}
                >
                  {page.title}
                </p>
              )}
              {page.scripture && (
                <p
                  className="mt-[1.5%]"
                  style={{
                    color: color(theme.accent),
                    fontFamily: fontStack(theme.fontHead),
                    fontSize: pt(20),
                    fontStyle: theme.italicRef ? "italic" : undefined,
                  }}
                >
                  {page.scripture}
                </p>
              )}
              {body && (
                <p
                  className="mt-[3%] whitespace-pre-line"
                  style={{
                    color: color(theme.text),
                    fontFamily: fontStack(theme.fontBody),
                    fontSize: pt(28),
                    lineHeight: 1.25,
                  }}
                >
                  {body}
                </p>
              )}
            </>
          )}
        </div>
      )}
      {width > 0 && isScripture && (
        <div
          className="absolute inset-x-[4%] bottom-[3%] flex items-end justify-between gap-4"
          style={{
            color: color(theme.accent),
            fontFamily: fontStack(theme.fontHead),
            fontSize: `${Math.max(9, (14 / SLIDE_WIDTH_PT) * width)}px`,
            textShadow: shadow,
          }}
        >
          <span style={{ fontStyle: theme.italicRef ? "italic" : undefined }}>
            {page.scripture && page.scripture !== body ? page.scripture : ""}
          </span>
          <span className="italic">{page.title ?? ""}</span>
        </div>
      )}
    </div>
  );
}
