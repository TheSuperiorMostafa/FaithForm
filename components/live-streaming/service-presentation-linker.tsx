"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Event = { id: string; title: string; starts_at: string; status: string };
type Presentation = { id: string; sermon_id: string; version: number; mobile_visibility: string; unpublished_at: string | null; sermons: { title: string } | { title: string }[] };
type Options = { nextOffset: number | null; events: Event[]; presentations: Presentation[]; links: { event_id: string; presentation_id: string }[] };

/** The same association can be managed from either side of the service. */
export function ServicePresentationLinker({ sermonId }: { sermonId?: string }) {
  const id = useId();
  const [data, setData] = useState<Options | null>(null);
  const [eventId, setEventId] = useState("");
  const [presentationId, setPresentationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const load = useCallback(async (signal?: AbortSignal, offset = 0) => {
    try {
      const query = new URLSearchParams({ offset: String(offset) });
      if (sermonId) query.set("sermonId", sermonId);
      const response = await fetch(`/api/stream/sermon-link?${query}`, { signal });
      if (response.status === 403) { setDenied(true); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load service links.");
      setData(previous => {
        if (!previous || offset === 0) return result;
        const merge = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map(item => [item.id, item])).values()];
        return { events: merge(previous.events, result.events), presentations: merge(previous.presentations, result.presentations),
          links: [...new Map([...previous.links, ...result.links].map(link => [link.event_id, link])).values()], nextOffset: result.nextOffset };
      });
      setEventId(current => current || result.events.find((e: Event) => e.status === "live")?.id ||
        (sermonId ? result.links.find((link: Options["links"][number]) => result.presentations.some((p: Presentation) => p.id === link.presentation_id))?.event_id : "") || result.events[0]?.id || "");
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Could not load service links.");
    }
  }, [sermonId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const linked = data?.links.find(link => link.event_id === eventId)?.presentation_id;
    setPresentationId(linked ?? (sermonId ? data?.presentations.find(p => !p.unpublished_at && p.mobile_visibility !== "none")?.id ?? "" : ""));
  }, [data, eventId, sermonId]);

  async function save(remove = false) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/stream/sermon-link", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId, presentationId: remove ? null : presentationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the link.");
      setData(current => current ? { ...current,
        links: [...current.links.filter(link => link.event_id !== eventId), ...(remove ? [] : [{ event_id: eventId, presentation_id: presentationId }])],
      } : current);
      setMessage(remove ? "Presentation unlinked." : "Presentation linked. The service and its recording now point to these slides.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the link."); }
    finally { setBusy(false); }
  }

  if (denied) return null;
  const linkedId = data?.links.find(link => link.event_id === eventId)?.presentation_id;
  const linked = data?.presentations.find(p => p.id === linkedId);
  const selectable = data?.presentations.filter(p => !p.unpublished_at && p.mobile_visibility !== "none") ?? [];
  const title = (p: Presentation) => (Array.isArray(p.sermons) ? p.sermons[0]?.title : p.sermons.title) ?? "Sermon";
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-heading text-lg font-semibold">Sermon presentation &amp; livestream</h2>
      <p className="mt-1 text-sm text-muted-foreground">Let people open the slides while watching, or watch the service from its sermon. The recording keeps the same presentation.</p>
      {data ? <div className="mt-4 grid gap-4">
        <div>
          <label htmlFor={`${id}-service`} className="mb-1 block text-sm font-medium">Service</label>
          <select id={`${id}-service`} value={eventId} onChange={e => setEventId(e.target.value)} disabled={busy} className="w-full rounded-md border border-input bg-background p-2 text-sm">
            <option value="">Choose a service</option>
            {data.events.map(e => <option key={e.id} value={e.id}>{e.title} · {new Date(e.starts_at).toLocaleDateString()} · {e.status}</option>)}
          </select>
          {data.events.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Schedule a service or go live first.</p>}
        </div>
        <div>
          <label htmlFor={`${id}-presentation`} className="mb-1 block text-sm font-medium">Presentation shared in the app</label>
          <select id={`${id}-presentation`} value={presentationId} onChange={e => setPresentationId(e.target.value)} disabled={busy} className="w-full rounded-md border border-input bg-background p-2 text-sm">
            <option value="">Choose a presentation</option>
            {linkedId && !selectable.some(p => p.id === linkedId) && <option value={linkedId} disabled>{linked ? `${title(linked)} (no longer shared)` : "Another presentation is linked"}</option>}
            {selectable.map(p => <option key={p.id} value={p.id}>{title(p)} · Version {p.version}</option>)}
          </select>
          {selectable.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Share a sermon presentation in the app before linking it.</p>}
        </div>
        {data.nextOffset != null && <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void load(undefined, data.nextOffset!).finally(() => setBusy(false)); }}>Load older services and presentations</Button>}
        {linkedId && !linked && <p className="text-sm text-muted-foreground">This service already has a presentation. Updating the link replaces it.</p>}
        <p className="text-sm text-muted-foreground">Uses the selected version of the slides. People only see links to content they can access.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={busy || !eventId || !selectable.some(p => p.id === presentationId) || presentationId === linkedId}>{busy ? "Saving…" : linkedId ? "Update link" : "Link presentation"}</Button>
          {linkedId && <Button variant="outline" disabled={busy} onClick={() => void save(true)}>Unlink</Button>}
          {linked && !sermonId && <Link href={`/dashboard/sermon-builder/${linked.sermon_id}`} className="text-sm underline">Open sermon</Link>}
          {sermonId && linkedId && <Link href="/dashboard/live-streaming" className="text-sm underline">Open livestreams</Link>}
        </div>
      </div> : !message && <p className="mt-4 text-sm text-muted-foreground">Loading service links…</p>}
      {message && <p className="mt-3 text-sm" role="status">{message}</p>}
    </section>
  );
}
