import { ShieldAlert } from "lucide-react";

import { stopImpersonation } from "@/app/admin/impersonation-actions";

/**
 * The reminder that this is somebody else's church.
 *
 * Deliberately loud and deliberately not dismissible. Everything below it is
 * the real dashboard writing to real data, and the failure mode this exists to
 * prevent is forgetting that and sending a church's weekly email from a tab
 * left open since yesterday.
 */
export function ImpersonationBanner({
  churchName,
}: {
  churchName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-sm md:px-8">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <span>
          You are working inside{" "}
          <strong>{churchName ?? "this church"}</strong> as a platform admin.
          Anything you do here is done to their live account.
        </span>
      </p>
      <form action={stopImpersonation}>
        <button
          type="submit"
          className="min-h-9 rounded-lg border border-amber-600/40 bg-background px-3 font-semibold text-foreground hover:bg-muted"
        >
          Leave this church
        </button>
      </form>
    </div>
  );
}
