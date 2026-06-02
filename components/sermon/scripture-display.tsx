import type { SlideVerse } from "@/lib/bible/render";
import { cn } from "@/lib/utils";

type ScriptureDisplayProps = {
  verses: SlideVerse[];
  size?: "sm" | "lg";
  className?: string;
};

export function ScriptureDisplay({
  verses,
  size = "sm",
  className,
}: ScriptureDisplayProps) {
  const textSize = size === "lg" ? "text-2xl md:text-3xl" : "text-sm";

  return (
    <div className={cn("space-y-3 leading-relaxed", textSize, className)}>
      {verses.map((verse) => (
        <p key={verse.n} className="text-left">
          <sup className="mr-1.5 font-semibold text-primary">{verse.n}</sup>
          {verse.segments?.length ? (
            verse.segments.map((seg, i) => {
              if (seg.lineBreak) {
                return <br key={`${verse.n}-br-${i}`} />;
              }
              return (
                <span
                  key={`${verse.n}-seg-${i}`}
                  className={cn(
                    seg.wordsOfJesus && "text-red-500 dark:text-red-400",
                    seg.poem !== undefined && seg.poem > 0 && "ml-4 block",
                  )}
                >
                  {seg.text}
                </span>
              );
            })
          ) : (
            <span
              className={cn(
                verse.wordsOfJesus && "text-red-500 dark:text-red-400",
              )}
            >
              {verse.text}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}
