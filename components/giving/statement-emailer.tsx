"use client";

import { useState } from "react";
import { AlertTriangle, Download, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { SuccessState } from "@/components/ui/success-state";
import { plural } from "@/components/giving/giving-page-parts";
import { donorDisplayName } from "@/lib/giving/labels";

export type EmailableDonor = { id: string; name: string | null; email: string };

type Outcome = { sent: EmailableDonor[]; failed: EmailableDonor[] };

/** Donors per request: small enough to finish well inside a request time limit. */
const BATCH_SIZE = 10;

function newRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * "Email 142 donors": sends each donor their statement for the year as a PDF,
 * a few at a time, and ends with who got one and who didn't ("Sent to 140.
 * 2 didn't send. Download them to print.").
 */
export function StatementEmailer({
  year,
  donors,
  emailUnavailableReason,
}: {
  year: number;
  donors: EmailableDonor[];
  /** Set when email can't be used; the button is then not offered. */
  emailUnavailableReason: string | null;
}) {
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);

  const send = async (list: EmailableDonor[]) => {
    const ok = await confirmAction({
      title: `Email ${plural(list.length, "donor")} their ${year} statement?`,
      description: `Each donor gets one email from your church with their ${year} giving statement attached as a PDF. Emails can't be taken back once they're sent.`,
      confirmLabel: `Email ${plural(list.length, "donor")}`,
    });
    if (!ok) return;

    const runId = newRunId();
    const byId = new Map(list.map((d) => [d.id, d]));
    const sent: EmailableDonor[] = [];
    const failed: EmailableDonor[] = [];
    setSending(true);
    setDone(0);
    setOutcome(null);
    setStopped(null);

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("/api/dashboard/giving/statements/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, donorIds: batch.map((d) => d.id), runId }),
        });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; results?: { donorId: string; status: string }[] }
          | null;
        if (!res.ok || !data?.results) {
          // A refusal (no tax ID, emails switched off) applies to everyone
          // left, so stop rather than failing them one batch at a time.
          if (res.status === 400 || res.status === 403 || res.status === 503) {
            failed.push(...list.slice(i));
            setStopped(data?.error ?? "Sending stopped. Please try again.");
            break;
          }
          failed.push(...batch);
        } else {
          for (const result of data.results) {
            const donor = byId.get(result.donorId);
            if (!donor) continue;
            if (result.status === "sent") sent.push(donor);
            else if (result.status === "failed") failed.push(donor);
          }
        }
      } catch {
        failed.push(...batch);
      }
      setDone(Math.min(i + batch.length, list.length));
    }

    setSending(false);
    setOutcome({ sent, failed });
    if (failed.length === 0) {
      toast.success(`Sent ${year} statements to ${plural(sent.length, "donor")}.`);
    } else {
      toast.warning(`Sent to ${sent.length}. ${failed.length} didn't send.`);
    }
  };

  if (outcome) {
    return (
      <div className="flex flex-col gap-5">
        {outcome.failed.length === 0 ? (
          <SuccessState
            title={`Sent to ${plural(outcome.sent.length, "donor")}`}
            description={`Every donor who gave in ${year} has their statement in their inbox.`}
          />
        ) : (
          <div
            role="status"
            className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50 p-6 dark:border-orange-500/30 dark:bg-orange-500/10"
          >
            <p className="flex items-start gap-3 text-lg text-foreground">
              <AlertTriangle className="mt-1 size-5 shrink-0 text-orange-600" aria-hidden />
              <span>
                <strong>Sent to {outcome.sent.length}.</strong>{" "}
                {outcome.failed.length} didn&apos;t send. Download them to print, or try again.
              </span>
            </p>
            {stopped && <p className="text-[15px] text-foreground/80">{stopped}</p>}
            <ul className="flex flex-col divide-y divide-orange-200 rounded-xl border border-orange-200 bg-card dark:divide-orange-500/30 dark:border-orange-500/30">
              {outcome.failed.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">{donorDisplayName(d)}</span>
                    <span className="block truncate text-sm text-muted-foreground">{d.email}</span>
                  </span>
                  <a
                    href={`/api/dashboard/giving/statements/${d.id}?year=${year}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-[15px] font-semibold text-primary hover:bg-accent/10 dark:text-accent"
                  >
                    <Download className="size-5" aria-hidden />
                    Download PDF
                  </a>
                </li>
              ))}
            </ul>
            <div>
              <Button onClick={() => void send(outcome.failed)}>
                <Mail aria-hidden />
                Try again for {plural(outcome.failed.length, "donor")}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (emailUnavailableReason) {
    return (
      <p className="rounded-xl bg-muted/50 px-4 py-3 text-[15px] leading-relaxed text-muted-foreground">
        {emailUnavailableReason}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="lg" disabled={sending || donors.length === 0} onClick={() => void send(donors)}>
          {sending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Mail aria-hidden />}
          {sending ? "Sending…" : `Email ${plural(donors.length, "donor")}`}
        </Button>
      </div>
      {sending && (
        <p role="status" aria-live="polite" className="text-[15px] text-muted-foreground">
          Sending {done} of {donors.length}. Keep this page open until it finishes.
        </p>
      )}
    </div>
  );
}
