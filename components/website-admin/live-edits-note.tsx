import { Eye, Radio } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Says plainly what an edit does, on every Website editor.
 *
 * The site has no separate draft copy: section edits live in `site_overrides`,
 * design in `site_settings`, church facts in the church profile, and the public
 * renderer reads all three directly. Once the site is live, each autosaved
 * change is what visitors see. A draft/publish split would need a second copy
 * of all three that the public renderer reads instead, so for now being honest
 * about it is the safety net, together with confirmations and Undo on the
 * bigger changes (theme switch, section reset, unpublish).
 */
export function LiveEditsNote({
  isLive,
  className,
}: {
  isLive: boolean;
  className?: string;
}) {
  return isLive ? (
    <p
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-[15px] leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
        className,
      )}
    >
      <Radio className="mt-0.5 size-5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Your website is live. Changes go live as you type.</strong>{" "}
        Each change saves on its own after a moment, and visitors see it straight away.
      </span>
    </p>
  ) : (
    <p
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-border bg-muted/40 px-5 py-4 text-[15px] leading-relaxed text-foreground/85",
        className,
      )}
    >
      <Eye className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        <strong className="font-semibold">Your website isn&apos;t published yet.</strong>{" "}
        Changes save on their own, and only you can see them in the preview until you publish.
      </span>
    </p>
  );
}
