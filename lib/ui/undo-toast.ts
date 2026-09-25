"use client";

import { toast } from "sonner";

/**
 * Reversible actions happen immediately and offer Undo, instead of asking
 * "Are you sure?" first (docs/ux/DASHBOARD_SIMPLICITY_STANDARD.md §9).
 *
 *   undoToast(`${name} removed from Choir.`, async () => { await addBack(); });
 *
 * `onUndo` may return a user-facing error string to report that undo failed.
 */
export function undoToast(
  message: string,
  onUndo: () => Promise<string | void | null | undefined> | void,
  options: { undoneMessage?: string; duration?: number } = {},
) {
  toast.success(message, {
    duration: options.duration ?? 10_000,
    action: {
      label: "Undo",
      onClick: async () => {
        const failed = await onUndo();
        if (typeof failed === "string" && failed) {
          toast.error(failed);
        } else {
          toast.success(options.undoneMessage ?? "Undone.");
        }
      },
    },
  });
}
