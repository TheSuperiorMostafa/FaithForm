"use client";
import { useState } from "react";
import { Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportDetail, ReportListItem, listSuspensions, moderationLog } from "@/lib/messaging/moderation";
import * as actions from "@/app/dashboard/groups/actions";
import { cn } from "@/lib/utils";
import { dateTime, Empty, Field, Modal, Notice, Pill, Submit, useGroupAction } from "./shared";
import { reportReasonLabel, reportStatusLabel } from "./labels";

type Resolution = "dismiss" | "remove_message" | "remove_member" | "ban_member" | "suspend";
const RESOLUTION_DONE: Record<Resolution, string> = {
  dismiss: "Report closed with no action.",
  remove_message: "Message removed for everyone.",
  remove_member: "Person removed from the group.",
  ban_member: "Person removed and can’t rejoin.",
  suspend: "Their messages are paused.",
};

export function Moderation({ reports, suspensions, log }: { reports: ReportListItem[]; suspensions: Awaited<ReturnType<typeof listSuspensions>>; log: Awaited<ReturnType<typeof moderationLog>> }) {
  const [filter, setFilter] = useState<"open" | "closed">("open"); const [report, setReport] = useState<ReportDetail | null>(null); const { pending, error, run } = useGroupAction();
  const visible = reports.filter(r => filter === "open" ? r.status === "open" : r.status !== "open");
  const openCount = reports.filter(r => r.status === "open").length;
  return <div className="flex flex-col gap-6">
    <div className="g-toolbar">
      <div className="g-segment" role="group" aria-label="Show">{(["open", "closed"] as const).map(f => <button type="button" key={f} aria-pressed={filter === f} className={cn(filter === f && "is-active")} onClick={() => setFilter(f)}>{f === "open" ? "Needs review" : "Handled"} <span className="g-segment-count">{f === "open" ? openCount : reports.length - openCount}</span></button>)}</div>
      <p className="text-[15px] text-muted-foreground">Only church staff can see this page.</p>
    </div>
    {error && <Notice>{error}</Notice>}
    {visible.length ? <ul className="g-list" aria-label="Reports">{visible.map(r => <li className="g-list-row" key={r.id}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="g-row-title">{reportReasonLabel(r.reason)}</span><Pill tone={r.status === "open" ? "attention" : "done"}>{reportStatusLabel(r.status)}</Pill></div>
        <p className="g-row-sub">About {r.reportedName} · {r.where.kind === "group" ? r.where.groupName : r.where.kind === "direct" ? "Private message" : "Unknown chat"} · {dateTime(r.createdAt)}</p>
        {r.excerpt && <p className="g-quote line-clamp-2">{r.excerpt}</p>}
      </div>
      <Button variant={r.status === "open" ? "default" : "outline"} disabled={pending} onClick={() => run(() => actions.readReport(r.id), undefined, setReport)}><Eye className="size-5" aria-hidden />{r.status === "open" ? "Review report" : "See what happened"}</Button>
    </li>)}</ul> : <Empty icon="safety" title={filter === "open" ? "Nothing to review" : "No handled reports yet"} description={filter === "open" ? "When someone reports a message in the app, it shows up here." : "Reports your team has handled are kept here."} />}

    <details className="g-panel g-details"><summary>People whose messages are paused ({suspensions.length})</summary>{suspensions.length ? <ul>{suspensions.map(s => <li className="g-row" key={s.id}><div><p className="g-row-title">{s.name}</p><p className="g-row-sub">{s.until ? `Until ${dateTime(s.until)}` : "Until someone turns them back on"} · {s.reason}</p></div><Button variant="outline" disabled={pending} onClick={() => run(() => actions.liftSuspension(s.id), `${s.name} can send messages again.`)}><RotateCcw className="size-5" aria-hidden />Turn messages back on</Button></li>)}</ul> : <p className="g-row-sub mt-3">No one’s messages are paused.</p>}</details>
    <details className="g-panel g-details"><summary>What your team has done</summary>{log.length ? <ul>{log.map(l => <li className="g-row" key={l.id}><div><p className="g-row-title">{l.label}{l.target && ` · ${l.target}`}</p><p className="g-row-sub">{l.actor} · {dateTime(l.at)}{l.reason && ` · ${l.reason}`}</p></div></li>)}</ul> : <p className="g-row-sub mt-3">Actions your team takes will be listed here.</p>}</details>
    {report && <Modal open wide onClose={() => setReport(null)} title={`Report about ${report.reportedName}`} description={reportReasonLabel(report.reason)}><ReportReview report={report} close={() => setReport(null)} /></Modal>}
  </div>;
}

function ReportReview({ report, close }: { report: ReportDetail; close: () => void }) {
  const { pending, error, run } = useGroupAction();
  const [resolution, setResolution] = useState<Resolution>("dismiss");
  return <div className="space-y-5">
    <div><p className="g-row-sub">Reported by {report.reporterName ?? "an automatic check"} · {dateTime(report.createdAt)}</p>{report.details && <p className="mt-3 text-base">{report.details}</p>}</div>
    {report.where.kind === "direct" && <Notice tone="info">For privacy, you can only see the reported message. Other private messages are never shown to staff.</Notice>}
    {report.context?.length ? <div className="max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-border p-4">{report.context.map(m => <div key={m.id} className={m.isReported ? "g-reported" : "p-3"}><p className="mb-1 text-sm font-semibold">{m.authorName}{m.isReported && " · Reported message"}</p><p className="whitespace-pre-wrap break-words text-[15px]">{m.removed ? "Message removed" : m.text || (m.attachments ? "A photo or file" : "No text")}</p></div>)}</div> : report.excerpt && <blockquote className="g-quote">{report.excerpt}</blockquote>}
    {report.contextUnavailable && <Notice tone="info">The messages around it can’t be loaded right now. You’re seeing the saved report.</Notice>}
    <p className="text-[15px] text-muted-foreground">{report.reportedPerson.otherReports === 1 ? "1 other report" : `${report.reportedPerson.otherReports} other reports`} about this person.</p>
    {report.status === "open" ? <form className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.resolveReport(report.id, resolution, String(f.get("note")), String(f.get("duration") ?? "7d") as "24h" | "7d" | "30d" | "indefinite"), RESOLUTION_DONE[resolution], close); }}>
      <Field label="What should happen?"><select value={resolution} onChange={e => setResolution(e.target.value as Resolution)}><option value="dismiss">Nothing. Close the report</option>{report.type === "message" && <option value="remove_message">Remove this message for everyone</option>}{report.reportedPerson.groupMembershipId && <><option value="remove_member">Remove the person from this group</option><option value="ban_member">Remove them and don’t let them back in</option></>}{report.reportedPerson.authUserId && <option value="suspend">Pause their messages for a while</option>}</select></Field>
      {resolution === "suspend" && <Field label="For how long?"><select name="duration" defaultValue="7d"><option value="24h">1 day</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="indefinite">Until someone turns them back on</option></select></Field>}
      <Field label={resolution === "dismiss" ? "Note for your team (optional)" : "Note for your team"} hint="Only staff see this. It’s kept with the report."><textarea name="note" rows={3} maxLength={1000} required={resolution !== "dismiss"} /></Field>
      {resolution !== "dismiss" && <p className="text-[15px] text-muted-foreground">This happens as soon as you save.</p>}
      {error && <Notice>{error}</Notice>}
      <div className="g-form-actions"><Submit pending={pending}>{resolution === "dismiss" ? "Close report" : "Save and apply"}</Submit></div>
    </form> : <div className="space-y-2 rounded-2xl bg-muted p-4 text-[15px]"><Pill tone="done">{reportStatusLabel(report.status)}</Pill><p>{report.resolutionNote ?? "Your team reviewed this report."}</p></div>}
  </div>;
}
