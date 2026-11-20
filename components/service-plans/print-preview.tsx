"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { NOTE_CATEGORIES, NOTE_CATEGORY_LABELS, type NoteCategory, type SharePreset } from "@/lib/service-plans/types";
import { presetDefaults } from "@/lib/service-plans/view";

export type PrintTeam = { id: string; name: string; noteCategories: NoteCategory[] };
export type PrintPerson = { id: string; name: string };
export type PrintTime = { id: string; label: string };

const PRESET_OPTIONS: { value: SharePreset; label: string }[] = [
  { value: "order", label: "Order of service" },
  { value: "full", label: "Full plan" },
  { value: "team", label: "Team view" },
  { value: "person", label: "Person view" },
];

const PRESET_HELP: Record<SharePreset, string> = {
  order: "Just the running order and times, for the bulletin or the platform.",
  full: "Everything in the plan, with every note.",
  team: "The whole plan with the notes one team needs.",
  person: "Only the parts one person leads, at their real times.",
};

type Settings = {
  showTimes: boolean;
  showLengths: boolean;
  showDescriptions: boolean;
  showLeaders: boolean;
  categories: NoteCategory[];
};

function settingsFor(preset: SharePreset, team: PrintTeam | undefined): Settings {
  const d = presetDefaults(preset);
  return {
    showTimes: d.showTimes,
    showLengths: d.showLengths,
    showDescriptions: d.showDescriptions,
    showLeaders: d.showLeaders,
    categories: preset === "team" && team ? [...team.noteCategories] : [...d.categories],
  };
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={id} className="text-[15px] font-medium text-foreground">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function PrintPreview({
  planId,
  teams,
  people,
  times,
  defaultTimeId,
}: {
  planId: string;
  teams: PrintTeam[];
  people: PrintPerson[];
  times: PrintTime[];
  defaultTimeId: string | null;
}) {
  const [preset, setPreset] = useState<SharePreset>("order");
  const [teamId, setTeamId] = useState<string>(teams[0]?.id ?? "");
  const [personId, setPersonId] = useState<string>(people[0]?.id ?? "");
  const [timeId, setTimeId] = useState<string>(defaultTimeId ?? times[0]?.id ?? "");
  const [landscape, setLandscape] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => settingsFor("order", undefined));

  const team = teams.find((t) => t.id === teamId);
  const needsPerson = preset === "person" && !personId;

  function choosePreset(next: SharePreset) {
    setPreset(next);
    setSettings(settingsFor(next, team));
  }

  function chooseTeam(id: string) {
    setTeamId(id);
    const next = teams.find((t) => t.id === id);
    setSettings((s) => ({ ...s, categories: next ? [...next.noteCategories] : s.categories }));
  }

  function toggleCategory(category: NoteCategory, on: boolean) {
    setSettings((s) => ({
      ...s,
      categories: NOTE_CATEGORIES.filter((c) => (c === category ? on : s.categories.includes(c))),
    }));
  }

  const pdfUrl = useMemo(() => {
    const params = new URLSearchParams({ preset });
    if (preset !== "order") params.set("categories", settings.categories.join(","));
    if (preset === "team" && teamId) params.set("teamId", teamId);
    if (preset === "person" && personId) params.set("personId", personId);
    if (timeId) params.set("timeId", timeId);
    params.set("times", settings.showTimes ? "1" : "0");
    params.set("lengths", settings.showLengths ? "1" : "0");
    params.set("descriptions", settings.showDescriptions ? "1" : "0");
    params.set("leaders", settings.showLeaders ? "1" : "0");
    params.set("orientation", landscape ? "landscape" : "portrait");
    return `/api/dashboard/plans/${planId}/pdf?${params.toString()}`;
  }, [planId, preset, teamId, personId, timeId, settings, landscape]);

  // The preview fetches the PDF itself so a failure shows a plain message
  // instead of raw error text inside the frame. Changes settle for a moment
  // first, so flipping several switches makes one request.
  const [preview, setPreview] = useState<{ url: string | null; state: "loading" | "ready" | "error" }>({
    url: null,
    state: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (needsPerson) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPreview((p) => ({ ...p, state: "loading" }));
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(pdfUrl, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        objectUrl = URL.createObjectURL(await response.blob());
        setPreview({ url: objectUrl, state: "ready" });
      } catch {
        if (!controller.signal.aborted) setPreview({ url: null, state: "error" });
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfUrl, needsPerson, attempt]);

  const showNotes = preset !== "order";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section aria-labelledby="print-options" className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 dark:shadow-none">
        <h2 id="print-options" className="font-heading text-lg font-semibold text-foreground">
          What to print
        </h2>

        <div className="flex flex-col gap-2">
          <SegmentedControl
            label="Who it's for"
            value={preset}
            options={PRESET_OPTIONS}
            onChange={choosePreset}
            className="grid w-full grid-cols-2"
          />
          <p className="text-[15px] text-muted-foreground">{PRESET_HELP[preset]}</p>
        </div>

        {preset === "team" && teams.length > 0 && (
          <div className="flex flex-col gap-2">
            <label htmlFor="print-team" className="text-sm font-semibold text-foreground">
              Team
            </label>
            <Select id="print-team" value={teamId} onChange={(e) => chooseTeam(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {preset === "person" && (
          <div className="flex flex-col gap-2">
            <label htmlFor="print-person" className="text-sm font-semibold text-foreground">
              Person
            </label>
            {people.length > 0 ? (
              <Select id="print-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-[15px] text-muted-foreground">
                No one leads an item or serves on this plan yet. Add leaders or a team first.
              </p>
            )}
          </div>
        )}

        {times.length > 1 && (
          <div className="flex flex-col gap-2">
            <label htmlFor="print-time" className="text-sm font-semibold text-foreground">
              Times for
            </label>
            <Select id="print-time" value={timeId} onChange={(e) => setTimeId(e.target.value)}>
              {times.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-foreground">Show</legend>
          <ToggleRow
            id="print-times"
            label="Start times"
            checked={settings.showTimes}
            onChange={(v) => setSettings((s) => ({ ...s, showTimes: v }))}
          />
          <ToggleRow
            id="print-lengths"
            label="Lengths"
            checked={settings.showLengths}
            onChange={(v) => setSettings((s) => ({ ...s, showLengths: v }))}
          />
          <ToggleRow
            id="print-leaders"
            label="Who leads"
            checked={settings.showLeaders}
            onChange={(v) => setSettings((s) => ({ ...s, showLeaders: v }))}
          />
          <ToggleRow
            id="print-descriptions"
            label="Descriptions"
            checked={settings.showDescriptions}
            onChange={(v) => setSettings((s) => ({ ...s, showDescriptions: v }))}
          />
          <ToggleRow id="print-landscape" label="Landscape page" checked={landscape} onChange={setLandscape} />
        </fieldset>

        {showNotes && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold text-foreground">Notes to include</legend>
            {NOTE_CATEGORIES.map((category) => {
              const id = `print-note-${category}`;
              return (
                <label key={category} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-foreground">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={settings.categories.includes(category)}
                    onChange={(e) => toggleCategory(category, e.target.checked)}
                  />
                  {NOTE_CATEGORY_LABELS[category]}
                </label>
              );
            })}
          </fieldset>
        )}
      </section>

      <section aria-labelledby="print-preview" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="print-preview" className="font-heading text-lg font-semibold text-foreground">
            Preview
          </h2>
          {needsPerson ? (
            <Button size="lg" disabled>
              <Download aria-hidden className="size-5" />
              Download PDF
            </Button>
          ) : (
            <Button size="lg" nativeButton={false} render={<a href={`${pdfUrl}&download=1`} download />}>
              <Download aria-hidden className="size-5" />
              Download PDF
            </Button>
          )}
        </div>
        <div className="relative h-[70vh] min-h-[480px] overflow-hidden rounded-2xl border border-border bg-muted/40">
          {needsPerson ? (
            <p className="flex h-full items-center justify-center p-6 text-center text-[15px] text-muted-foreground">
              Choose a person to see their copy.
            </p>
          ) : preview.state === "error" ? (
            <ErrorState
              title="The preview didn't load"
              description="Nothing was changed. Try again, or download the PDF instead."
              onRetry={() => setAttempt((n) => n + 1)}
              className="h-full p-6"
            />
          ) : (
            <>
              {preview.url && (
                <iframe
                  key={preview.url}
                  src={preview.url}
                  title="Preview of the PDF"
                  className="size-full bg-white"
                />
              )}
              {preview.state === "loading" && (
                <div role="status" aria-label="Updating preview" className="absolute inset-0 flex flex-col gap-4 bg-card/80 p-8">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                  <Skeleton className="h-1 w-full" />
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
