"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clapperboard,
  Clock,
  FileText,
  GripVertical,
  Heading,
  ListOrdered,
  Music,
  NotebookPen,
  Plus,
  Printer,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  createItemAction,
  deleteItemAction,
  deletePlanAction,
  duplicateItemAction,
  getPlanAction,
  reorderItemAction,
  restoreItemAction,
  saveAsTemplateAction,
  setItemLeadersAction,
  updateItemAction,
  updatePlanAction,
  updatePlanTimesAction,
  upsertNoteAction,
} from "@/app/dashboard/plans/actions";
import { resendShareAction } from "@/app/dashboard/plans/share-actions";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAutosavedField, usePlanRealtime } from "@/components/service-plans/editor/hooks";
import { ItemPanel } from "@/components/service-plans/editor/item-panel";
import { LeaderChips, LeadersDialog, type PositionOption } from "@/components/service-plans/editor/leaders-dialog";
import { PlanTeam } from "@/components/service-plans/editor/plan-team";
import { PlanTimesDialog, type DraftPlanTime } from "@/components/service-plans/editor/plan-times-dialog";
import { ShareDialog } from "@/components/service-plans/share/share-dialog";
import { SongPickerDialog } from "@/components/service-plans/songs/song-picker-dialog";
import type { SongPickerOption } from "@/lib/service-plans/songs/types";
import {
  buildTimeline,
  describeDuration,
  formatClockTime,
  formatDuration,
  formatPlanDate,
  overTargetSeconds,
} from "@/lib/service-plans/timing";
import {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABELS,
  type ItemType,
  type Leader,
  type NoteCategory,
  type PersonOption,
  type Plan,
  type PlanItem,
  type Team,
} from "@/lib/service-plans/types";
import { undoToast } from "@/lib/ui/undo-toast";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<ItemType, typeof FileText> = {
  item: FileText,
  song: Music,
  header: Heading,
  media: Clapperboard,
};

type SongTarget = { mode: "add" } | { mode: "change"; itemId: string };
type Drag = { id: string; from: number; over: number; dy: number; height: number };

function PlanNoteField({
  planId,
  category,
  body,
  onSaved,
  onError,
}: {
  planId: string;
  category: NoteCategory;
  body: string;
  onSaved: (category: NoteCategory, body: string) => void;
  onError: (m: string) => void;
}) {
  const field = useAutosavedField(body, (v) => upsertNoteAction(planId, null, category, v), {
    onSaved: (v) => onSaved(category, v),
    onError,
  });
  return (
    <>
      <Label htmlFor={`plan-note-${category}`} className="sr-only">
        {NOTE_CATEGORY_LABELS[category]} plan note
      </Label>
      <Textarea
        id={`plan-note-${category}`}
        rows={5}
        maxLength={8000}
        value={field.value}
        placeholder={`${NOTE_CATEGORY_LABELS[category]} notes for the whole service`}
        onChange={(e) => field.onChange(e.target.value)}
        {...field.focusProps}
      />
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {field.state === "saving" ? "Saving…" : field.state === "saved" ? "Saved" : ""}
      </p>
    </>
  );
}

export function PlanEditor({
  initialPlan,
  people,
  teams,
  timeZone,
  userId,
}: {
  initialPlan: Plan;
  people: PersonOption[];
  teams: Team[];
  timeZone: string;
  userId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState(initialPlan);
  const planRef = useRef(plan);
  planRef.current = plan;
  const [pending, startTransition] = useTransition();

  const serviceTimes = plan.times.filter((t) => t.kind === "service");
  const [timeId, setTimeId] = useState<string | null>(serviceTimes[0]?.id ?? null);
  const selectedTime = plan.times.find((t) => t.id === timeId) ?? serviceTimes[0] ?? plan.times[0] ?? null;
  const timeline = useMemo(() => buildTimeline(plan.items, selectedTime?.startsAt ?? null), [plan.items, selectedTime]);
  const over = overTargetSeconds(timeline.totalSeconds, plan.targetSeconds);

  const openItemId = searchParams.get("item");
  const openItem = plan.items.find((i) => i.id === openItemId) ?? null;
  const [leadersFor, setLeadersFor] = useState<string | null>(null);
  const [songTarget, setSongTarget] = useState<SongTarget | null>(null);
  const [timesOpen, setTimesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(() => plan.notes.some((n) => n.itemId === null));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [remoteChange, setRemoteChange] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<{ startY: number; rects: DOMRect[]; from: number; over: number; id: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const positions: PositionOption[] = useMemo(
    () => teams.flatMap((t) => t.positions.map((p) => ({ id: p.id, name: p.name, label: `${t.name} · ${p.name}` }))),
    [teams],
  );

  const showError = useCallback((message: string) => toast.error(message), []);

  const refresh = useCallback(async () => {
    const result = await getPlanAction(planRef.current.id);
    if (result.ok) setPlan(result.plan);
    else toast.error(result.error);
  }, []);

  // Someone else's edit: catch up, and say so. Our own edits echo back too;
  // the refresh is harmless and the banner only shows for another person.
  usePlanRealtime(plan.id, (events) => {
    if (dragRef.current) return;
    if (events.some((e) => e.updatedBy && e.updatedBy !== userId)) setRemoteChange(true);
    void refresh();
  });

  const setItemParam = useCallback(
    (itemId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (itemId) params.set("item", itemId);
      else params.delete("item");
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const openPanel = (itemId: string) => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setItemParam(itemId);
  };
  const closePanel = () => {
    setItemParam(null);
    requestAnimationFrame(() => lastFocus.current?.focus());
  };

  const patchItem = (itemId: string, patch: Partial<PlanItem>) =>
    setPlan((p) => ({ ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));

  const setNote = (itemId: string | null, category: NoteCategory, body: string) =>
    setPlan((p) => {
      const rest = p.notes.filter((n) => !(n.itemId === itemId && n.category === category));
      return body.trim()
        ? { ...p, notes: [...rest, { id: `local-${itemId}-${category}`, itemId, category, body, updatedAt: new Date().toISOString() }] }
        : { ...p, notes: rest };
    });

  // ---- reorder ----------------------------------------------------------

  const moveItem = (from: number, to: number) => {
    if (from === to || to < 0 || to >= planRef.current.items.length) return;
    const before = planRef.current.items;
    const items = [...before];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    setPlan((p) => ({ ...p, items }));
    setAnnouncement(`Moved ${moved.title} to position ${to + 1} of ${items.length}.`);
    const afterId = to === 0 ? null : items[to - 1].id;
    startTransition(async () => {
      const result = await reorderItemAction(moved.id, afterId);
      if (!result.ok) {
        setPlan((p) => ({ ...p, items: before }));
        toast.error(result.error);
        return;
      }
      patchItem(moved.id, { position: result.position });
    });
  };

  const onHandlePointerDown = (event: React.PointerEvent, index: number, id: string) => {
    if (event.button !== 0 || !listRef.current) return;
    event.preventDefault();
    // preventDefault also stops the browser focusing the handle, and the arrow
    // keys only work once it has focus.
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-row]"));
    const rects = rows.map((r) => r.getBoundingClientRect());
    dragRef.current = { startY: event.clientY, rects, from: index, over: index, id };
    setDrag({ id, from: index, over: index, dy: 0, height: rects[index]?.height ?? 56 });
  };
  const onHandlePointerMove = (event: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = event.clientY - d.startY;
    const center = d.rects[d.from].top + d.rects[d.from].height / 2 + dy;
    let overIndex = d.from;
    d.rects.forEach((r, i) => {
      const mid = r.top + r.height / 2;
      if (i < d.from && center < mid) overIndex = Math.min(overIndex, i);
      if (i > d.from && center > mid) overIndex = Math.max(overIndex, i);
    });
    d.over = overIndex;
    setDrag((prev) => (prev ? { ...prev, dy, over: overIndex } : prev));
  };
  const onHandlePointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d && d.over !== d.from) moveItem(d.from, d.over);
  };

  const rowShift = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < drag.over && index > drag.from && index <= drag.over) return -drag.height;
    if (drag.over < drag.from && index >= drag.over && index < drag.from) return drag.height;
    return 0;
  };

  // ---- item commands ----------------------------------------------------

  const addItem = (itemType: ItemType, song?: { songId: string; arrangementId: string | null }) =>
    startTransition(async () => {
      const result = await createItemAction(plan.id, {
        itemType,
        songId: song?.songId ?? null,
        arrangementId: song?.arrangementId ?? null,
      });
      if (!result.ok) return void toast.error(result.error);
      await refresh();
      openPanel(result.id);
    });

  const deleteItem = (item: PlanItem) =>
    startTransition(async () => {
      const before = planRef.current.items;
      setPlan((p) => ({ ...p, items: p.items.filter((i) => i.id !== item.id) }));
      if (openItemId === item.id) setItemParam(null);
      const result = await deleteItemAction(item.id);
      if (!result.ok) {
        setPlan((p) => ({ ...p, items: before }));
        return void toast.error(result.error);
      }
      undoToast(
        `${item.title} deleted.`,
        async () => {
          const undo = await restoreItemAction(item.id);
          await refresh();
          return undo.ok ? undefined : undo.error;
        },
        { undoneMessage: `${item.title} is back.` },
      );
    });

  const duplicateItem = (item: PlanItem) =>
    startTransition(async () => {
      const result = await duplicateItemAction(item.id);
      if (!result.ok) return void toast.error(result.error);
      await refresh();
      toast.success(`${item.title} duplicated.`);
      openPanel(result.id);
    });

  const moveToHeader = (item: PlanItem, headerId: string | null) => {
    const items = planRef.current.items;
    const from = items.findIndex((i) => i.id === item.id);
    let to: number;
    if (headerId === null) {
      to = 0;
    } else {
      const h = items.findIndex((i) => i.id === headerId);
      // Last spot in that section: before the next header.
      let end = items.findIndex((i, idx) => idx > h && i.itemType === "header");
      if (end === -1) end = items.length;
      to = from < end ? end - 1 : end;
      if (from <= h) to = Math.max(h, to);
    }
    moveItem(from, Math.max(0, Math.min(items.length - 1, to)));
  };

  const saveLeaders = (itemId: string, leaders: Leader[]) => {
    const before = planRef.current.items.find((i) => i.id === itemId)?.leaders ?? [];
    patchItem(itemId, { leaders });
    startTransition(async () => {
      const result = await setItemLeadersAction(
        itemId,
        leaders.map((l) => ({ personId: l.personId, teamPositionId: l.teamPositionId })),
      );
      if (!result.ok) {
        patchItem(itemId, { leaders: before });
        toast.error(result.error);
      }
    });
  };

  const pickSong = (song: SongPickerOption, arrangementId: string | null) => {
    const target = songTarget;
    setSongTarget(null);
    if (!target) return;
    if (target.mode === "add") {
      addItem("song", { songId: song.id, arrangementId });
      return;
    }
    startTransition(async () => {
      const result = await updateItemAction(target.itemId, { songId: song.id, arrangementId });
      if (!result.ok) return void toast.error(result.error);
      await refresh();
    });
  };

  const renameInline = (item: PlanItem, title: string) => {
    setRenaming(null);
    const next = title.trim();
    if (!next || next === item.title) return;
    patchItem(item.id, { title: next });
    startTransition(async () => {
      const result = await updateItemAction(item.id, { title: next });
      if (!result.ok) {
        patchItem(item.id, { title: item.title });
        toast.error(result.error);
      }
    });
  };

  // ---- plan commands ----------------------------------------------------

  const saveTimes = (draft: DraftPlanTime[]) =>
    startTransition(async () => {
      const result = await updatePlanTimesAction(
        plan.id,
        draft.map(({ kind, label, date, time }) => ({ kind, label, date, time })),
      );
      if (!result.ok) return void toast.error(result.error);
      setTimesOpen(false);
      toast.success("Service times saved. Start times have been worked out again.");
      await refresh();
    });

  const resend = () =>
    startTransition(async () => {
      const result = await resendShareAction(plan.id);
      if (!result.ok) return void toast.error(result.error);
      toast.success(
        result.sent === 0
          ? "Everyone already has the latest plan."
          : `Changes sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}.`,
      );
      await refresh();
    });

  const saveAsTemplate = () => {
    const name = `${plan.title || plan.serviceTypeName} template`;
    startTransition(async () => {
      const result = await saveAsTemplateAction(plan.id, name);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`Saved as the template “${name}”. Find it on the Templates tab.`);
    });
  };

  const deletePlan = async () => {
    const label = plan.isTemplate ? `the ${plan.title} template` : `the plan for ${plan.date ? formatPlanDate(plan.date) : "this date"}`;
    const ok = await confirmAction({
      title: `Delete ${label}?`,
      description: "Its items, notes, team and share links go with it. This can't be undone.",
      confirmLabel: plan.isTemplate ? "Delete template" : "Delete plan",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deletePlanAction(plan.id);
      if (!result.ok) return void toast.error(result.error);
      toast.success(plan.isTemplate ? "Template deleted." : "Plan deleted.");
      router.push(`/dashboard/plans/${plan.serviceTypeId}`);
    });
  };

  useEffect(() => {
    if (openItemId && !openItem && plan.items.length) setItemParam(null);
  }, [openItemId, openItem, plan.items.length, setItemParam]);

  // ---- render -----------------------------------------------------------

  const headers = plan.items.filter((i) => i.itemType === "header").map((h) => ({ id: h.id, title: h.title }));
  const headerOf = (itemId: string): string | null => {
    let current: string | null = null;
    for (const i of plan.items) {
      if (i.id === itemId) return current;
      if (i.itemType === "header") current = i.id;
    }
    return current;
  };
  const startLabel = (itemId: string): string | null => {
    const row = timeline.byId.get(itemId);
    if (!row || row.offsetSeconds === null) return null;
    if (row.startsAt) return formatClockTime(row.startsAt, timeZone);
    return `+${formatDuration(row.offsetSeconds)}`;
  };
  const notedItems = new Set(plan.notes.filter((n) => n.itemId && n.body.trim()).map((n) => n.itemId));
  const changedSinceShare = plan.lastSharedVersion !== null && plan.shareVersion > plan.lastSharedVersion;
  const leadersItem = plan.items.find((i) => i.id === leadersFor) ?? null;
  const heading = plan.isTemplate ? plan.title : plan.date ? formatPlanDate(plan.date) : "Plan";

  return (
    <div className={cn("flex w-full flex-col gap-6", openItem && "lg:pr-[460px]")}>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="flex flex-col gap-4">
        <Button variant="link" className="w-fit" nativeButton={false} render={<Link href={`/dashboard/plans/${plan.serviceTypeId}`} />}>
          <ArrowLeft aria-hidden className="size-4" />
          {plan.serviceTypeName}
        </Button>

        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {plan.isTemplate && <StatusBadge tone="neutral">Template</StatusBadge>}
              {plan.series && <StatusBadge tone="neutral">Series: {plan.series}</StatusBadge>}
            </div>
            <h1 className="font-heading text-[28px] font-bold leading-tight sm:text-[32px]">{heading}</h1>
            {!plan.isTemplate && plan.title && <p className="text-lg font-semibold text-muted-foreground">{plan.title}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {plan.times.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTimesOpen(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-[15px] font-semibold hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Edit times: ${t.label} at ${formatClockTime(t.startsAt, timeZone)}`}
                >
                  <Clock aria-hidden className="size-4 text-muted-foreground" />
                  {t.label} {formatClockTime(t.startsAt, timeZone)}
                </button>
              ))}
              {!plan.isTemplate && (
                <Button variant="ghost" size="sm" onClick={() => setTimesOpen(true)}>
                  <Plus aria-hidden />
                  {plan.times.length ? "Add or change times" : "Add a service time"}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(true)}>
                Edit {plan.isTemplate ? "name" : "date and title"}
              </Button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button variant={notesOpen ? "secondary" : "outline"} aria-pressed={notesOpen} onClick={() => setNotesOpen((v) => !v)}>
              <NotebookPen aria-hidden />
              Plan notes
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/dashboard/plans/${plan.serviceTypeId}/${plan.id}/print`} />}
            >
              <Printer aria-hidden />
              Print
            </Button>
            {!plan.isTemplate && (
              <Button onClick={() => setShareOpen(true)}>
                <Send aria-hidden />
                Share
              </Button>
            )}
          </div>
        </header>

        {changedSinceShare && (
          <div role="status" className="flex flex-col gap-3 rounded-2xl border border-accent/50 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px] font-semibold">Updated since last share. Your teams are looking at an older version.</p>
            <Button onClick={resend} disabled={pending}>
              <RefreshCw aria-hidden />
              Re-send changes
            </Button>
          </div>
        )}
        {remoteChange && (
          <div role="status" className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px]">Someone else just changed this plan. You’re seeing their changes.</p>
            <Button variant="ghost" onClick={() => setRemoteChange(false)}>
              OK
            </Button>
          </div>
        )}
      </div>

      {/* With the item panel open it takes 460px from the right, so the side
          column waits for a much wider screen before sitting beside the order. */}
      <div
        className={cn(
          "grid gap-6",
          openItem ? "min-[1760px]:grid-cols-[minmax(0,1fr)_320px]" : "xl:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        <section aria-labelledby="order-title" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="order-title" className="font-heading text-xl font-bold">
              Order of service
            </h2>
            {serviceTimes.length > 1 && selectedTime && (
              <SegmentedControl
                label="Show start times for"
                value={selectedTime.id}
                options={serviceTimes.map((t) => ({ value: t.id, label: formatClockTime(t.startsAt, timeZone) }))}
                onChange={setTimeId}
              />
            )}
          </div>

          {plan.items.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
              <ListOrdered aria-hidden className="mx-auto size-10 text-muted-foreground" />
              <p className="mt-3 font-semibold">Nothing in this plan yet</p>
              <p className="text-[15px] text-muted-foreground">Add items, songs and section headers below.</p>
            </div>
          ) : (
            <ol
              ref={listRef}
              aria-label="Order of service"
              className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-sm"
            >
              {plan.items.map((item, index) => {
                const Icon = TYPE_ICONS[item.itemType];
                const row = timeline.byId.get(item.id);
                const isHeader = item.itemType === "header";
                const dragging = drag?.id === item.id;
                const shift = rowShift(index);
                return (
                  <li
                    key={item.id}
                    data-row
                    style={{
                      transform: dragging ? `translateY(${drag.dy}px)` : shift ? `translateY(${shift}px)` : undefined,
                    }}
                    className={cn(
                      "relative grid min-h-14 grid-cols-[44px_64px_minmax(0,1fr)_auto] items-center gap-x-2 bg-card px-2 py-1.5 sm:grid-cols-[44px_72px_28px_minmax(0,1fr)_auto_64px_16px] sm:gap-x-3",
                      isHeader && "bg-primary/[0.06] dark:bg-accent/10",
                      openItemId === item.id && "ring-2 ring-inset ring-accent",
                      dragging ? "z-10 shadow-card-hover" : drag && "transition-transform duration-150 motion-reduce:transition-none",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Move ${item.title}. Use the up and down arrow keys.`}
                      className="flex size-11 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                      onPointerDown={(e) => onHandlePointerDown(e, index, item.id)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                      onPointerCancel={onHandlePointerUp}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                          e.preventDefault();
                          const target = index + (e.key === "ArrowUp" ? -1 : 1);
                          moveItem(index, target);
                          requestAnimationFrame(() =>
                            listRef.current
                              ?.querySelectorAll<HTMLButtonElement>("[data-row] > button:first-child")
                              [Math.max(0, Math.min(plan.items.length - 1, target))]?.focus(),
                          );
                        }
                      }}
                    >
                      <GripVertical aria-hidden className="size-5" />
                    </button>

                    <span className="text-[15px] font-semibold tabular-nums text-muted-foreground">
                      {isHeader ? "" : startLabel(item.id)}
                    </span>

                    <span className="hidden sm:flex" title={item.itemType}>
                      <Icon aria-hidden className="size-5 text-muted-foreground" />
                    </span>

                    <span className="min-w-0">
                      {renaming === item.id ? (
                        <Input
                          autoFocus
                          defaultValue={item.title}
                          aria-label={`Rename ${item.title}`}
                          maxLength={200}
                          onBlur={(e) => renameInline(item, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameInline(item, (e.target as HTMLInputElement).value);
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRenaming(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => openPanel(item.id)}
                          onDoubleClick={() => setRenaming(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === "F2") setRenaming(item.id);
                          }}
                          className={cn(
                            "flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg px-2 text-left hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isHeader && "font-heading font-bold uppercase tracking-wide",
                          )}
                        >
                          <span className="truncate text-[15px] font-semibold">{item.title}</span>
                          {item.song && (
                            <span className="truncate text-sm text-muted-foreground">
                              {[item.song.key ? `Key of ${item.song.key}` : null, item.song.arrangementName].filter(Boolean).join(" · ")}
                            </span>
                          )}
                          {isHeader && (
                            <span className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
                              {formatDuration(row?.subtotalSeconds ?? 0)} in this section
                            </span>
                          )}
                        </button>
                      )}
                    </span>

                    {isHeader ? (
                      <span className="col-span-1 sm:col-span-3" />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setLeadersFor(item.id)}
                          aria-label={`Leaders for ${item.title}`}
                          className="col-start-3 row-start-2 flex min-h-11 items-center rounded-lg px-2 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-start-auto sm:row-start-auto"
                        >
                          <LeaderChips leaders={item.leaders} />
                        </button>
                        <span className="text-right text-[15px] font-semibold tabular-nums">{formatDuration(item.lengthSeconds)}</span>
                        <span className="hidden sm:flex sm:justify-center">
                          {notedItems.has(item.id) && (
                            <span className="size-2.5 rounded-full bg-accent" title="Has notes">
                              <span className="sr-only">Has notes</span>
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex flex-wrap gap-2" role="group" aria-label="Add to the plan">
            <Button variant="outline" disabled={pending} onClick={() => addItem("item")}>
              <Plus aria-hidden />
              Item
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setSongTarget({ mode: "add" })}>
              <Music aria-hidden />
              Song
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => addItem("header")}>
              <Heading aria-hidden />
              Header
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => addItem("media")}>
              <Clapperboard aria-hidden />
              Media
            </Button>
          </div>

          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-5 py-4 text-[15px]",
              over !== null && over > 0
                ? "border-amber-500/60 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                : "border-border bg-card",
            )}
          >
            <span className="font-semibold">Total {formatDuration(timeline.totalSeconds)}</span>
            {plan.targetSeconds ? (
              <span className="flex items-center gap-2">
                {over !== null && over > 0 && <AlertTriangle aria-hidden className="size-4" />}
                Target {formatDuration(plan.targetSeconds)}
                {over !== null &&
                  (over > 0 ? ` · Over by ${describeDuration(over)}` : over < 0 ? ` · ${describeDuration(-over)} to spare` : " · Right on target")}
              </span>
            ) : (
              <span className="text-muted-foreground">No target length set</span>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-6" aria-label="Plan details">
          {notesOpen && (
            <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby="plan-notes-title">
              <h2 id="plan-notes-title" className="font-heading text-lg font-bold">
                Plan notes
              </h2>
              <Tabs defaultValue="general">
                <TabsList aria-label="Plan note categories" className="max-w-full justify-start overflow-x-auto">
                  {NOTE_CATEGORIES.map((c) => (
                    <TabsTrigger key={c} value={c} className="px-3">
                      {NOTE_CATEGORY_LABELS[c]}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {NOTE_CATEGORIES.map((c) => (
                  <TabsContent key={c} value={c} keepMounted>
                    <PlanNoteField
                      planId={plan.id}
                      category={c}
                      body={plan.notes.find((n) => n.itemId === null && n.category === c)?.body ?? ""}
                      onSaved={(category, body) => setNote(null, category, body)}
                      onError={showError}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </section>
          )}

          {!plan.isTemplate && <PlanTeam planId={plan.id} team={plan.team} teams={teams} people={people} onChanged={refresh} />}

          <section className="space-y-2 rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby="running-total-title">
            <h2 id="running-total-title" className="font-heading text-lg font-bold">
              Running total
            </h2>
            <p className="text-3xl font-bold tabular-nums">{formatDuration(timeline.totalSeconds)}</p>
            {plan.targetSeconds ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn("h-full rounded-full", over !== null && over > 0 ? "bg-amber-500" : "bg-accent")}
                    style={{ width: `${Math.min(100, (timeline.totalSeconds / plan.targetSeconds) * 100)}%` }}
                  />
                </div>
                <p className="text-[15px] text-muted-foreground">of {formatDuration(plan.targetSeconds)} target</p>
              </>
            ) : null}
            {selectedTime && timeline.totalSeconds > 0 && (
              <p className="text-[15px] text-muted-foreground">
                Ends about {formatClockTime(new Date(new Date(selectedTime.startsAt).getTime() + timeline.totalSeconds * 1000), timeZone)}
              </p>
            )}
          </section>

          <AdvancedSection title="More for this plan">
            <div className="flex flex-col gap-2">
              {!plan.isTemplate && (
                <Button variant="outline" disabled={pending} onClick={saveAsTemplate}>
                  Save as template
                </Button>
              )}
              <Button variant="destructive" disabled={pending} onClick={deletePlan}>
                {plan.isTemplate ? "Delete template" : "Delete plan"}
              </Button>
            </div>
          </AdvancedSection>
        </aside>
      </div>

      {openItem && (
        <ItemPanel
          key={openItem.id}
          planId={plan.id}
          item={openItem}
          notes={plan.notes.filter((n) => n.itemId === openItem.id)}
          startLabel={startLabel(openItem.id)}
          headers={headers}
          currentHeaderId={headerOf(openItem.id)}
          onClose={closePanel}
          onItemSaved={(patch) => patchItem(openItem.id, patch)}
          onNoteSaved={(category, body) => setNote(openItem.id, category, body)}
          onEditLeaders={() => setLeadersFor(openItem.id)}
          onChangeSong={() => setSongTarget({ mode: "change", itemId: openItem.id })}
          onDuplicate={() => duplicateItem(openItem)}
          onMoveToHeader={(headerId) => moveToHeader(openItem, headerId)}
          onDelete={() => deleteItem(openItem)}
          onError={showError}
        />
      )}

      {leadersItem && (
        <LeadersDialog
          open={Boolean(leadersItem)}
          onOpenChange={(open) => !open && setLeadersFor(null)}
          itemTitle={leadersItem.title}
          value={leadersItem.leaders}
          people={people}
          positions={positions}
          onSave={(leaders) => saveLeaders(leadersItem.id, leaders)}
        />
      )}

      <SongPickerDialog open={songTarget !== null} onOpenChange={(open) => !open && setSongTarget(null)} onPick={pickSong} />

      <PlanTimesDialog
        open={timesOpen}
        onOpenChange={setTimesOpen}
        times={plan.times}
        planDate={plan.date}
        timeZone={timeZone}
        onSave={saveTimes}
        pending={pending}
      />

      <PlanDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        plan={plan}
        onSaved={async () => {
          setDetailsOpen(false);
          await refresh();
          router.refresh();
        }}
      />

      {!plan.isTemplate && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          plan={plan}
          teams={teams}
          people={people}
          onShared={refresh}
        />
      )}
    </div>
  );
}

function PlanDetailsDialog({
  open,
  onOpenChange,
  plan,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(plan.date ?? "");
  const [title, setTitle] = useState(plan.title ?? "");
  const [series, setSeries] = useState(plan.series ?? "");
  const [pending, start] = useTransition();
  useEffect(() => {
    if (open) {
      setDate(plan.date ?? "");
      setTitle(plan.title ?? "");
      setSeries(plan.series ?? "");
    }
  }, [open, plan.date, plan.title, plan.series]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex min-h-0 flex-auto flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await updatePlanAction(plan.id, {
                title,
                series,
                ...(plan.isTemplate ? {} : { date }),
              });
              if (!result.ok) return void toast.error(result.error);
              toast.success(plan.isTemplate ? "Template renamed." : "Plan details saved. Times moved with the date.");
              onSaved();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{plan.isTemplate ? "Template name" : "Date and title"}</DialogTitle>
            <DialogDescription>
              {plan.isTemplate ? "What this template is called when making a new plan." : "Moving the date keeps every time at the same clock time."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-5">
            {!plan.isTemplate && (
              <div className="space-y-2">
                <Label htmlFor="plan-date">Date</Label>
                <DatePicker id="plan-date" value={date} onChange={setDate} required />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="plan-title">{plan.isTemplate ? "Name" : "Title (optional)"}</Label>
              <Input id="plan-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required={plan.isTemplate} />
            </div>
            {!plan.isTemplate && (
              <div className="space-y-2">
                <Label htmlFor="plan-series">Series (optional)</Label>
                <Input id="plan-series" value={series} maxLength={120} onChange={(e) => setSeries(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
