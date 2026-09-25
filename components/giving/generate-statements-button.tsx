"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Every statement for the year as PDFs in one ZIP file, for printing or
 * sending by hand. The secondary way; emailing is the main one.
 */
export function GenerateStatementsButton({
  year,
  hasEin,
  count,
}: {
  year: number;
  hasEin: boolean;
  count: number;
}) {
  const [pending, startTransition] = useTransition();

  const generate = () => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/dashboard/giving/statements/generate?year=${year}`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(data?.error ?? "We couldn't make the statements. Please try again.");
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `giving-statements-${year}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded ${year} statements for ${count} donors.`);
      } catch {
        toast.error("We couldn't reach the server. Check your connection and try again.");
      }
    });
  };

  return (
    <Button type="button" variant="outline" disabled={pending || !hasEin || count === 0} onClick={generate}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      {pending ? "Making statements…" : `Download all ${year} statements (ZIP)`}
    </Button>
  );
}
