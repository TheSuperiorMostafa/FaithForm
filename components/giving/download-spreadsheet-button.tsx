"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { SpreadsheetKind } from "@/lib/giving/spreadsheet";

const WHAT: Record<SpreadsheetKind, string> = {
  donors: "donors",
  recurring: "recurring gifts",
  deposits: "deposits",
};

/**
 * "Download spreadsheet": the whole list behind a Giving page as a CSV file
 * that Excel, Numbers and Google Sheets open. Fetched rather than linked so a
 * failure shows a plain-language message instead of a page of raw text.
 */
export function DownloadSpreadsheetButton({ kind }: { kind: SpreadsheetKind }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    const fallback = `We couldn't make the ${WHAT[kind]} spreadsheet. Please try again.`;
    try {
      const res = await fetch(`/api/dashboard/giving/export/${kind}`, { cache: "no-store" });
      if (!res.ok) {
        // The route only ever returns plain sentences, never raw errors.
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const message =
          res.status === 401 || res.status === 403
            ? "Only church admins can download this spreadsheet. Ask an admin for a copy."
            : typeof body?.error === "string" && body.error.startsWith("We couldn't")
              ? body.error
              : typeof body?.error === "string" && body.error.startsWith("Connect ")
                ? body.error
                : fallback;
        toast.error(message);
        return;
      }
      const blob = await res.blob();
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${kind}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Downloaded ${filename}. Open it in Excel, Numbers or Google Sheets.`);
    } catch {
      toast.error(fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={download} disabled={busy} aria-busy={busy}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      Download spreadsheet
    </Button>
  );
}
