import { chartUnits, parseChartLines, parseLyricLines, type ChartSegment } from "@/lib/service-plans/songs/chart";
import { cn } from "@/lib/utils";

/**
 * A chord chart as a band reads it: section name, then each line of words
 * with its chords on their own row directly above, each chord over the
 * syllable where it changes.
 *
 * Alignment does not depend on a monospaced font: every word is its own
 * inline column (chord on top, word below), so the chord sits over the word
 * whatever the font, and a long line wraps between words without losing it.
 * Chords are bold and navy (gold in dark mode), and smaller than the words.
 *
 * No hooks, so it renders on the server (share page) and in the editor's
 * live preview alike.
 */

const NBSP = "\u00a0";

function ChordLyric({ segments }: { segments: ChartSegment[] }) {
  if (!segments.some((s) => s.chord)) {
    return <p className="whitespace-pre-wrap">{segments.map((s) => s.text).join("")}</p>;
  }
  return (
    <p className="mt-1 flex flex-wrap items-end">
      {chartUnits(segments).map((unit, i) => (
        <span key={i} className={cn("inline-flex flex-col", unit.space && "mr-[0.3em]")}>
          <span
            className={cn(
              "text-[0.82em] font-bold leading-tight text-brand-navy dark:text-accent",
              unit.chord && "pr-[0.45em]",
            )}
          >
            {unit.chord ?? NBSP}
          </span>
          <span className="whitespace-pre">{unit.word || NBSP}</span>
        </span>
      ))}
    </p>
  );
}

export function ChordChart({ chart, className }: { chart: string; className?: string }) {
  const lines = parseChartLines(chart);
  if (!lines.length) return null;
  return (
    <div className={cn("text-base leading-snug text-foreground", className)}>
      {lines.map((line, i) => {
        switch (line.kind) {
          case "section":
            return (
              <p
                key={i}
                className="mt-4 text-[0.8em] font-bold uppercase tracking-wide text-brand-navy first:mt-0 dark:text-accent"
              >
                {line.text}
              </p>
            );
          case "chords":
            return (
              <p key={i} className="mt-1 whitespace-pre-wrap text-[0.82em] font-bold text-brand-navy dark:text-accent">
                {line.text}
              </p>
            );
          case "lyric":
            return <ChordLyric key={i} segments={line.segments} />;
          default:
            return <div key={i} aria-hidden className="h-3" />;
        }
      })}
    </div>
  );
}

export function LyricsSheet({ lyrics, className }: { lyrics: string; className?: string }) {
  const lines = parseLyricLines(lyrics);
  if (!lines.length) return null;
  return (
    <div className={cn("text-base leading-relaxed text-foreground", className)}>
      {lines.map((line, i) =>
        line.kind === "section" ? (
          <p
            key={i}
            className="mt-4 text-[0.8em] font-bold uppercase tracking-wide text-brand-navy first:mt-0 dark:text-accent"
          >
            {line.text}
          </p>
        ) : line.kind === "text" ? (
          <p key={i}>{line.text}</p>
        ) : (
          <div key={i} aria-hidden className="h-3" />
        ),
      )}
    </div>
  );
}
