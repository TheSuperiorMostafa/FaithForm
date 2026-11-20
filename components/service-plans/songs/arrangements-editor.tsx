"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ListMusic, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createArrangementAction,
  deleteArrangementAction,
  updateArrangementAction,
} from "@/app/dashboard/plans/songs/actions";
import { KeySelect } from "@/components/service-plans/songs/key-select";
import { SongAttachments } from "@/components/service-plans/songs/song-attachments";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { sectionLabel } from "@/lib/service-plans/songs/parsers";
import type { SongArrangement } from "@/lib/service-plans/songs/types";
import { formatDuration, parseDuration } from "@/lib/service-plans/timing";

export function ArrangementsEditor({
  songId,
  defaultKey,
  arrangements,
}: {
  songId: string;
  defaultKey: string | null;
  arrangements: SongArrangement[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState(arrangements[0]?.id ?? "");
  const [adding, startAdd] = useTransition();
  const active = arrangements.some((a) => a.id === tab) ? tab : (arrangements[0]?.id ?? "");

  const add = () =>
    startAdd(async () => {
      const name = arrangements.length ? `Arrangement ${arrangements.length + 1}` : "Default";
      const result = await createArrangementAction(songId, { name, key: defaultKey });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added the “${name}” arrangement. Give it a name and a chart below.`);
      setTab(result.id);
      router.refresh();
    });

  const addButton = (
    <Button variant="outline" onClick={add} disabled={adding}>
      <Plus aria-hidden className="size-5" />
      {adding ? "Adding…" : "Add arrangement"}
    </Button>
  );

  if (!arrangements.length) {
    return (
      <EmptyState
        compact
        icon={ListMusic}
        title="No arrangements yet"
        description="An arrangement holds the key, the order of verses and choruses, and the chord chart your team plays from."
        action={addButton}
      />
    );
  }

  if (arrangements.length === 1) {
    return (
      <div className="flex flex-col gap-4">
        <ArrangementForm key={arrangements[0].id} arrangement={arrangements[0]} />
        <div>{addButton}</div>
      </div>
    );
  }

  return (
    <Tabs defaultValue={active} value={active} onValueChange={setTab}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabsList className="inline-flex max-w-full items-center gap-1 overflow-x-auto border-b border-border text-muted-foreground">
          {arrangements.map((a) => (
            <TabsTrigger key={a.id} value={a.id}>
              {a.name}
              {a.key ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">({a.key})</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {addButton}
      </div>
      {arrangements.map((a) => (
        <TabsContent key={a.id} value={a.id}>
          <ArrangementForm key={a.id} arrangement={a} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function sectionsInText(...texts: (string | null)[]): string[] {
  const names: string[] = [];
  for (const text of texts) {
    for (const line of (text ?? "").split("\n")) {
      const name = sectionLabel(line);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

function ArrangementForm({ arrangement }: { arrangement: SongArrangement }) {
  const router = useRouter();
  const id = arrangement.id;
  const [name, setName] = useState(arrangement.name);
  const [key, setKey] = useState(arrangement.key ?? "");
  const [bpm, setBpm] = useState(arrangement.bpm ? String(arrangement.bpm) : "");
  const [length, setLength] = useState(arrangement.lengthSeconds ? formatDuration(arrangement.lengthSeconds) : "");
  const [order, setOrder] = useState(arrangement.sectionOrder.join(", "));
  const [chart, setChart] = useState(arrangement.chartText ?? "");
  const [lyrics, setLyrics] = useState(arrangement.lyrics ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const lengthSeconds = length.trim() ? parseDuration(length) : null;
  const lengthInvalid = length.trim() !== "" && (lengthSeconds === null || lengthSeconds > 7200);
  const sections = useMemo(() => sectionsInText(chart, lyrics), [chart, lyrics]);

  const appendSection = (section: string) =>
    setOrder((current) => (current.trim() ? `${current.replace(/[,\s]+$/, "")}, ${section}` : section));

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (lengthInvalid) {
      setError("Type the length like 4:30, up to 2:00:00.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await updateArrangementAction(id, {
        name,
        key,
        bpm: bpm.trim() ? Number(bpm) : null,
        lengthSeconds,
        sectionOrder: order.split(","),
        chartText: chart,
        lyrics,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Saved the “${name.trim()}” arrangement.`);
      router.refresh();
    });
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete the “${arrangement.name}” arrangement?`,
      description: "Its chord chart, lyrics and files are deleted for good. Plans that used it keep the song.",
      confirmLabel: "Delete arrangement",
      destructive: true,
    });
    if (!ok) return;
    startDelete(async () => {
      const result = await deleteArrangementAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted the “${arrangement.name}” arrangement.`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <form onSubmit={save} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 sm:col-span-2 lg:col-span-1">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-key`}>Key</Label>
            <KeySelect id={`${id}-key`} value={key} onChange={setKey} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-length`}>Length</Label>
            <Input
              id={`${id}-length`}
              value={length}
              onChange={(e) => setLength(e.target.value)}
              placeholder="4:30"
              inputMode="numeric"
              aria-invalid={lengthInvalid || undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-bpm`}>BPM</Label>
            <Input
              id={`${id}-bpm`}
              type="number"
              min={20}
              max={300}
              step={1}
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${id}-order`}>Order of sections</Label>
          <Input
            id={`${id}-order`}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            placeholder="Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus"
            aria-describedby={`${id}-order-help`}
          />
          <p id={`${id}-order-help`} className="text-sm text-muted-foreground">
            Separate sections with commas.{sections.length ? " Tap a section from the chart to add it." : ""}
          </p>
          {sections.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <Button key={section} type="button" variant="secondary" size="sm" onClick={() => appendSection(section)}>
                  <Plus aria-hidden />
                  {section}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${id}-chart`}>Chord chart</Label>
          <Textarea
            id={`${id}-chart`}
            value={chart}
            onChange={(e) => setChart(e.target.value)}
            rows={14}
            spellCheck={false}
            className="font-mono text-sm leading-relaxed"
            placeholder={"Verse 1\n[G]Amazing grace, how [C]sweet the [G]sound"}
            aria-describedby={`${id}-chart-help`}
          />
          <p id={`${id}-chart-help`} className="text-sm text-muted-foreground">
            Put chords in square brackets before the word, or on their own line above it.
          </p>
        </div>

        <AdvancedSection title="Lyrics" description="Words only, without chords, for slides and printouts." defaultOpen={Boolean(arrangement.lyrics)}>
          <div className="space-y-2">
            <Label htmlFor={`${id}-lyrics`}>Lyrics</Label>
            <Textarea id={`${id}-lyrics`} value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={12} />
          </div>
        </AdvancedSection>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => void remove()} disabled={deleting}>
            <Trash2 aria-hidden className="size-5" />
            {deleting ? "Deleting…" : "Delete arrangement"}
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            <Save aria-hidden className="size-5" />
            {saving ? "Saving…" : "Save arrangement"}
          </Button>
        </div>
      </form>

      <div className="border-t border-border pt-6">
        <SongAttachments arrangementId={id} initial={arrangement.attachments} />
      </div>
    </div>
  );
}
