import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Static: renders as real text in loading states too. */
export function CcliNote({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-[15px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary dark:text-accent" />
      <p>
        <span className="font-semibold text-foreground">Your church needs its own CCLI license.</span> To copy, print
        or project song lyrics and charts, your church must hold its own current CCLI Church Copyright License.
        FaithForm keeps your songs organized but does not license them. Hymns in the public domain need no license.
      </p>
    </div>
  );
}
