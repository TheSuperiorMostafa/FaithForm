import type { Metadata } from "next";
import { Download, ExternalLink, FileText, Link2 } from "lucide-react";
import { AttendanceAnswer } from "@/components/service-plans/share/attendance-answer";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { recordView } from "@/lib/service-plans/share";
import { formatClockTime, formatDuration, formatPlanDate } from "@/lib/service-plans/timing";
import { SHARE_PRESET_LABELS, type PlanFile } from "@/lib/service-plans/types";
import { buildPlanView } from "@/lib/service-plans/view";
import { cn } from "@/lib/utils";
import { loadSharedPlanByToken, shareViewOptions } from "./load";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Service plan",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type PageProps = { params: Promise<{ token: string }>; searchParams: Promise<{ time?: string }> };

function FileLinks({ files, token }: { files: PlanFile[]; token: string }) {
  return (
    <span className="flex flex-wrap gap-2 pt-1">
      {files.map((f) => {
        const Icon = f.isFile ? FileText : Link2;
        return (
          <a
            key={`${f.source}-${f.id}`}
            href={f.url ?? `/plan/${token}/files/${f.source}/${f.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[10px] border border-border px-3 text-[15px] font-semibold text-primary hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{f.name}</span>
            {f.url && <ExternalLink aria-hidden className="size-4 shrink-0" />}
            {f.detail && <span className="sr-only">({f.detail})</span>}
          </a>
        );
      })}
    </span>
  );
}

function Unavailable() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-heading text-2xl font-bold">This link isn’t working</h1>
      <p className="text-base text-muted-foreground">
        It may have expired after the service, or your church turned it off. Ask whoever sent it for a new one.
      </p>
    </main>
  );
}

export default async function SharedPlanPage({ params, searchParams }: PageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const loaded = await loadSharedPlanByToken(token);
  if (!loaded) return <Unavailable />;
  const { share, plan, church } = loaded;

  const admin = createAdminClientOrNull();
  if (admin) await recordView(admin, share);

  const options = shareViewOptions(share);
  const view = buildPlanView(plan, { ...options, timeId: query.time ?? null });
  const tz = church.timezone;
  const serviceTimes = view.times.filter((t) => t.kind === "service");
  const recipient = share.person_id ? plan.attendance?.find((a) => a.personId === share.person_id) : undefined;
  const person = options.preset === "person" ? recipient?.personName : null;
  const answer = recipient?.status === "confirmed" || recipient?.status === "declined" ? recipient.status : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="space-y-2 border-b-2 border-accent pb-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{church.name}</p>
        <h1 className="font-heading text-[28px] font-bold leading-tight">
          {view.serviceTypeName}
          {view.date ? ` · ${formatPlanDate(view.date)}` : ""}
        </h1>
        {view.title && <p className="text-lg font-semibold">{view.title}</p>}
        <p className="text-[15px] text-muted-foreground">
          {SHARE_PRESET_LABELS[options.preset]}
          {person ? ` for ${person}` : ""} ·{" "}
          {view.times.map((t) => `${t.label} ${formatClockTime(t.startsAt, tz)}`).join(" · ")}
        </p>
        {serviceTimes.length > 1 && (
          <nav aria-label="Show start times for" className="flex flex-wrap gap-2 pt-1">
            {serviceTimes.map((t) => (
              <a
                key={t.id}
                href={`?time=${t.id}`}
                aria-current={t.id === view.selectedTimeId ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-[15px] font-semibold",
                  t.id === view.selectedTimeId ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {formatClockTime(t.startsAt, tz)}
              </a>
            ))}
          </nav>
        )}
      </header>

      {share.person_id && (
        <AttendanceAnswer
          token={token}
          initial={answer}
          firstName={recipient?.personName.split(" ")[0] ?? null}
          when={view.date ? formatPlanDate(view.date) : view.serviceTypeName}
        />
      )}

      {view.planNotes.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-4" aria-label="Notes for the whole service">
          {view.planNotes.map((n) => (
            <p key={n.category} className="whitespace-pre-wrap text-[15px]">
              <span className="font-semibold">{n.label}: </span>
              {n.body}
            </p>
          ))}
        </section>
      )}

      {view.rows.length === 0 ? (
        <p className="text-base text-muted-foreground">Nothing in this plan for you yet.</p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-label="Order of service">
          {view.rows.map((row) =>
            row.itemType === "header" ? (
              <li key={row.id} className="flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-primary-foreground">
                <span className="font-heading font-bold uppercase tracking-wide">{row.title}</span>
                {row.subtotalSeconds !== null && <span className="text-sm tabular-nums">{formatDuration(row.subtotalSeconds)}</span>}
              </li>
            ) : (
              <li key={row.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 px-4 py-3">
                <span className="font-semibold tabular-nums text-muted-foreground">
                  {row.startsAt ? formatClockTime(row.startsAt, tz) : ""}
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block font-semibold">{row.title}</span>
                  {row.songLine && <span className="block text-sm text-muted-foreground">{row.songLine}</span>}
                  {row.leaders.length > 0 && <span className="block text-sm text-muted-foreground">{row.leaders.join(", ")}</span>}
                  {row.description && <span className="block whitespace-pre-wrap text-[15px]">{row.description}</span>}
                  {row.notes.map((n) => (
                    <span key={n.category} className="block whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 text-[15px]">
                      <span className="font-semibold">{n.label}: </span>
                      {n.body}
                    </span>
                  ))}
                  {row.files.length > 0 && <FileLinks files={row.files} token={token} />}
                </span>
                <span className="text-right font-semibold tabular-nums">
                  {row.lengthSeconds !== null ? formatDuration(row.lengthSeconds) : ""}
                </span>
              </li>
            ),
          )}
        </ol>
      )}

      <footer className="flex flex-col gap-3 text-[15px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Total {formatDuration(view.totalSeconds)}
          {view.targetSeconds ? ` · Target ${formatDuration(view.targetSeconds)}` : ""}
        </span>
        <a
          href={`/plan/${token}/pdf${view.selectedTimeId ? `?time=${view.selectedTimeId}` : ""}`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-primary/45 px-5 font-semibold text-primary"
        >
          <Download aria-hidden className="size-5" />
          Download PDF
        </a>
      </footer>
      <p className="text-sm text-muted-foreground">
        This page always shows the latest plan. It is only for you, so please don’t forward it.
      </p>
    </main>
  );
}
