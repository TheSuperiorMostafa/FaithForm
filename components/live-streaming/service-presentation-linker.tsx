"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { serviceStatusLabel } from "@/lib/stream/user-errors";

type Event = { id: string; title: string; starts_at: string; status: string };
type Presentation = { id: string; sermon_id: string; version: number; mobile_visibility: string; unpublished_at: string | null; sermons: { title: string } | { title: string }[] };
type Options = { nextOffset: number | null; events: Event[]; presentations: Presentation[]; links: { event_id: string; presentation_id: string }[] };

const SELECT_CLASS =
  "h-11 w-full rounded-[10px] border border-input bg-background px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/**
 * Links a sermon's slides to a service, so people can open the slides while
 * they watch. The same association can be managed from either side: from a
 * service here, or from the sermon in Sermons.
 */
export function ServicePresentationLinker({ sermonId, bare = false }: { sermonId?: string; bare?: boolean }) {
  const id = useId();
  const [data, setData] = useState<Options | null>(null);
  const [eventId, setEventId] = useState("");
  const [presentationId, setPresentationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const load = useCallback(async (signal?: AbortSignal, offset = 0) => {
    try {
      const query = new URLSearchParams({ offset: String(offset) });
      if (sermonId) query.set("sermonId", sermonId);
      const response = await fetch(`/api/stream/sermon-link?${query}`, { signal });
      if (response.status === 403) { setDenied(true); return; }
      const result = await response.json();
      if (!response.ok) throw new Error("load_failed");
      setLoadFailed(false);
      setData(previous => {
        if (!previous || offset === 0) return result;
        const merge = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map(item => [item.id, item])).values()];
        return { events: merge(previous.events, result.events), presentations: merge(previous.presentations, result.presentations),
          links: [...new Map([...previous.links, ...result.links].map(link => [link.event_id, link])).values()], nextOffset: result.nextOffset };
      });
      setEventId(current => current || result.events.find((e: Event) => e.status === "live")?.id ||
        (sermonId ? result.links.find((link: Options["links"][number]) => result.presentations.some((p: Presentation) => p.id === link.presentation_id))?.event_id : "") || result.events[0]?.id || "");
    } catch {
      if (!signal?.aborted) setLoadFailed(true);
    }
  }, [sermonId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const linked = data?.links.find(link => link.event_id === eventId)?.presentation_id;
    setPresentationId(linked ?? (sermonId ? data?.presentations.find(p => !p.unpublished_at && p.mobile_visibility !== "none")?.id ?? "" : ""));
  }, [data, eventId, sermonId]);

  async function save(remove = false) {
    if (remove) {
      const service = data?.events.find(e => e.id === eventId);
      const ok = await confirmAction({
        title: "Remove the slides from this service?",
        description: `People watching${service ? ` “${service.title}”` : ""} won't see a link to the slides anymore. The slides themselves aren't changed, and you can link them again any time.`,
        confirmLabel: "Remove slides",
        cancelLabel: "Keep them",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/stream/sermon-link", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId, presentationId: remove ? null : presentationId }) });
      if (!response.ok) throw new Error("save_failed");
      setData(current => current ? { ...current,
        links: [...current.links.filter(link => link.event_id !== eventId), ...(remove ? [] : [{ event_id: eventId, presentation_id: presentationId }])],
      } : current);
      toast.success(remove ? "Slides removed from the service." : "Slides linked. The service and its recording now show these slides.");
    } catch {
      toast.error(remove ? "We couldn't remove the slides. Please try again." : "We couldn't link the slides. Please try again.");
    } finally { setBusy(false); }
  }

  if (denied) return null;
  const linkedId = data?.links.find(link => link.event_id === eventId)?.presentation_id;
  const linked = data?.presentations.find(p => p.id === linkedId);
  const selectable = data?.presentations.filter(p => !p.unpublished_at && p.mobile_visibility !== "none") ?? [];
  const title = (p: Presentation) => (Array.isArray(p.sermons) ? p.sermons[0]?.title : p.sermons.title) ?? "Sermon";
  const body = (
    <>
      {data ? <div className="grid gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-service`} className="text-[15px] font-medium">Service</label>
          <select id={`${id}-service`} value={eventId} onChange={e => setEventId(e.target.value)} disabled={busy} className={SELECT_CLASS}>
            <option value="">Choose a service</option>
            {data.events.map(e => <option key={e.id} value={e.id}>{e.title} · {new Date(e.starts_at).toLocaleDateString()} · {serviceStatusLabel(e.status)}</option>)}
          </select>
          {data.events.length === 0 && <p className="text-sm text-muted-foreground">Schedule a service or go live first.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-presentation`} className="text-[15px] font-medium">Slides shared in the app</label>
          <select id={`${id}-presentation`} value={presentationId} onChange={e => setPresentationId(e.target.value)} disabled={busy} className={SELECT_CLASS}>
            <option value="">Choose slides</option>
            {linkedId && !selectable.some(p => p.id === linkedId) && <option value={linkedId} disabled>{linked ? `${title(linked)} (no longer shared)` : "Other slides are linked"}</option>}
            {selectable.map(p => <option key={p.id} value={p.id}>{title(p)} · Version {p.version}</option>)}
          </select>
          {selectable.length === 0 && <p className="text-sm text-muted-foreground">Share a sermon&apos;s slides in the app first (in Sermons), then link them here.</p>}
        </div>
        {data.nextOffset != null && <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void load(undefined, data.nextOffset!).finally(() => setBusy(false)); }}>Show older services and slides</Button>}
        {linkedId && !linked && <p className="text-sm text-muted-foreground">This service already has slides. Linking new ones replaces them.</p>}
        <p className="text-sm text-muted-foreground">People only see links to things they&apos;re allowed to see.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={busy || !eventId || !selectable.some(p => p.id === presentationId) || presentationId === linkedId}>{busy ? "Saving…" : linkedId ? "Link these slides instead" : "Link slides"}</Button>
          {linkedId && <Button variant="outline" disabled={busy} onClick={() => void save(true)}>Remove slides</Button>}
          {linked && !sermonId && <Link href={`/dashboard/sermon-builder/${linked.sermon_id}`} className="text-[15px] font-medium underline underline-offset-4">Open sermon</Link>}
          {sermonId && linkedId && <Link href="/dashboard/live-streaming/upcoming" className="text-[15px] font-medium underline underline-offset-4">Open services</Link>}
        </div>
      </div> : loadFailed ? <p className="text-[15px] text-muted-foreground" role="status">We couldn&apos;t load your services and slides. Refresh the page to try again.</p>
        : <p className="text-[15px] text-muted-foreground">Loading services…</p>}
    </>
  );

  if (bare) return <div className="flex flex-col gap-4">{body}</div>;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-heading text-lg font-semibold">Sermon slides &amp; livestream</h2>
      <p className="mt-1 text-[15px] text-muted-foreground">Let people open the slides while watching, or watch the service from its sermon. The recording keeps the same slides.</p>
      <div className="mt-4">{body}</div>
    </section>
  );
}
