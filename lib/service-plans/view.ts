/**
 * What one audience sees of a plan.
 *
 * Print and share both start from the full plan and narrow it here, so the
 * sound tech's PDF and the sound tech's link show the same thing, and a
 * category a team may not see is removed before anything is rendered — it is
 * never sent to the browser and hidden there.
 *
 * Start times are worked out on the whole plan first and only then filtered,
 * so a Person view shows each item at its real time.
 */

import { buildTimeline } from "@/lib/service-plans/timing";
import {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABELS,
  type ItemType,
  type NoteCategory,
  type Plan,
  type PlanFile,
  type SharePreset,
} from "@/lib/service-plans/types";

export type PlanViewOptions = {
  preset: SharePreset;
  /** Note categories to include. Ignored for `order` (no notes). */
  categories: readonly NoteCategory[];
  /** Person view: whose items. */
  personId?: string | null;
  /** Which plan time the start times count from; defaults to the first service time. */
  timeId?: string | null;
  showTimes: boolean;
  showLengths: boolean;
  showDescriptions: boolean;
  showLeaders: boolean;
};

export type PlanViewNote = { category: NoteCategory; label: string; body: string };

export type PlanViewRow = {
  id: string;
  itemType: ItemType;
  title: string;
  /** ISO start, null for headers or when times are hidden. */
  startsAt: string | null;
  lengthSeconds: number | null;
  subtotalSeconds: number | null;
  leaders: string[];
  description: string | null;
  /** "Key of G · Acoustic · CCLI 7138371" */
  songLine: string | null;
  notes: PlanViewNote[];
  /** The item's files and its song's files; none in Order only. */
  files: PlanFile[];
};

export type PlanView = {
  serviceTypeName: string;
  date: string | null;
  title: string | null;
  series: string | null;
  times: { id: string; label: string; startsAt: string; kind: string }[];
  selectedTimeId: string | null;
  rows: PlanViewRow[];
  planNotes: PlanViewNote[];
  totalSeconds: number;
  targetSeconds: number | null;
  options: PlanViewOptions;
};

/** The defaults each preset starts from; print lets planners change them. */
export function presetDefaults(preset: SharePreset): Omit<PlanViewOptions, "personId" | "timeId"> {
  switch (preset) {
    case "full":
      return {
        preset,
        categories: [...NOTE_CATEGORIES],
        showTimes: true,
        showLengths: true,
        showDescriptions: true,
        showLeaders: true,
      };
    case "team":
      return {
        preset,
        categories: ["general"],
        showTimes: true,
        showLengths: true,
        showDescriptions: true,
        showLeaders: true,
      };
    case "person":
      return {
        preset,
        categories: [...NOTE_CATEGORIES],
        showTimes: true,
        showLengths: true,
        showDescriptions: true,
        showLeaders: true,
      };
    case "order":
      return {
        preset,
        categories: [],
        showTimes: true,
        showLengths: false,
        showDescriptions: false,
        showLeaders: false,
      };
  }
}

function songLine(item: Plan["items"][number]): string | null {
  if (!item.song) return null;
  const parts = [
    item.song.key ? `Key of ${item.song.key}` : null,
    item.song.arrangementName && item.song.arrangementName !== "Default" ? item.song.arrangementName : null,
    item.song.ccliNumber ? `CCLI ${item.song.ccliNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function buildPlanView(plan: Plan, options: PlanViewOptions): PlanView {
  const serviceTimes = plan.times.filter((t) => t.kind === "service");
  const selected =
    plan.times.find((t) => t.id === options.timeId) ?? serviceTimes[0] ?? plan.times[0] ?? null;
  const timeline = buildTimeline(plan.items, selected?.startsAt ?? null);

  const allowed = new Set<NoteCategory>(options.preset === "order" ? [] : options.categories);
  const notesFor = (itemId: string | null): PlanViewNote[] =>
    plan.notes
      .filter((n) => n.itemId === itemId && allowed.has(n.category) && n.body.trim())
      .sort((a, b) => NOTE_CATEGORIES.indexOf(a.category) - NOTE_CATEGORIES.indexOf(b.category))
      .map((n) => ({ category: n.category, label: NOTE_CATEGORY_LABELS[n.category], body: n.body }));

  // Person view: what they lead by name, or through a position they fill on
  // this plan's team.
  let personItems: Set<string> | null = null;
  if (options.preset === "person") {
    const positions = new Set(
      plan.team
        .filter((m) => m.personId === options.personId && m.status !== "declined")
        .map((m) => m.positionId),
    );
    personItems = new Set(
      plan.items
        .filter((item) =>
          item.leaders.some(
            (l) =>
              (options.personId && l.personId === options.personId) ||
              (l.teamPositionId !== null && l.personId === null && positions.has(l.teamPositionId)),
          ),
        )
        .map((item) => item.id),
    );
  }

  const rows: PlanViewRow[] = [];
  for (const item of plan.items) {
    if (personItems && item.itemType !== "header" && !personItems.has(item.id)) continue;
    const time = timeline.byId.get(item.id);
    rows.push({
      id: item.id,
      itemType: item.itemType,
      title: item.title,
      startsAt: options.showTimes && time?.startsAt ? time.startsAt.toISOString() : null,
      lengthSeconds: item.itemType === "header" || !options.showLengths ? null : item.lengthSeconds,
      subtotalSeconds: item.itemType === "header" && options.showLengths ? (time?.subtotalSeconds ?? 0) : null,
      leaders: options.showLeaders ? item.leaders.map((l) => l.name) : [],
      description: options.showDescriptions ? item.description : null,
      songLine: options.preset === "order" ? null : songLine(item),
      notes: notesFor(item.id),
      files: options.preset === "order" ? [] : (plan.files ?? []).filter((f) => f.itemId === item.id),
    });
  }

  // Person view: drop headers left with nothing under them.
  const visibleRows = personItems
    ? rows.filter((row, i) => {
        if (row.itemType !== "header") return true;
        const next = rows[i + 1];
        return next !== undefined && next.itemType !== "header";
      })
    : rows;

  return {
    serviceTypeName: plan.serviceTypeName,
    date: plan.date,
    title: plan.title,
    series: plan.series,
    times: plan.times.map((t) => ({ id: t.id, label: t.label, startsAt: t.startsAt, kind: t.kind })),
    selectedTimeId: selected?.id ?? null,
    rows: visibleRows,
    planNotes: options.preset === "person" ? [] : notesFor(null),
    totalSeconds: timeline.totalSeconds,
    targetSeconds: plan.targetSeconds,
    options,
  };
}
