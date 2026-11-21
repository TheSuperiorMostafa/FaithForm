"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Minus, Music, Plus, Trash2, X } from "lucide-react";
import { updateItemAction, upsertNoteAction } from "@/app/dashboard/plans/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { combineSaveStates, useAutosavedField, type SaveState } from "@/components/service-plans/editor/hooks";
import { ItemFiles } from "@/components/service-plans/editor/item-files";
import { LeaderChips } from "@/components/service-plans/editor/leaders-dialog";
import { formatDuration, parseDuration } from "@/lib/service-plans/timing";
import {
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABELS,
  type ItemType,
  type NoteCategory,
  type PlanFile,
  type PlanItem,
  type PlanNote,
} from "@/lib/service-plans/types";
import { cn } from "@/lib/utils";

const QUICK_MINUTES = [1, 2, 3, 5, 10, 15, 30];

function NoteField({
  planId,
  itemId,
  category,
  note,
  onSaved,
  onState,
  onError,
}: {
  planId: string;
  itemId: string;
  category: NoteCategory;
  note: PlanNote | undefined;
  onSaved: (category: NoteCategory, body: string) => void;
  onState: (category: NoteCategory, state: SaveState) => void;
  onError: (message: string) => void;
}) {
  const field = useAutosavedField(note?.body ?? "", (body) => upsertNoteAction(planId, itemId, category, body), {
    onSaved: (body) => onSaved(category, body),
    onError,
  });
  useEffect(() => onState(category, field.state), [category, field.state, onState]);
  return (
    <div className="space-y-2">
      <Label htmlFor={`note-${itemId}-${category}`} className="sr-only">
        {NOTE_CATEGORY_LABELS[category]} note
      </Label>
      <Textarea
        id={`note-${itemId}-${category}`}
        value={field.value}
        maxLength={8000}
        rows={4}
        placeholder={
          category === "tech"
            ? "Slide loop starts at 8:55; mic hands off to worship leader"
            : `${NOTE_CATEGORY_LABELS[category]} notes for this item`
        }
        onChange={(e) => field.onChange(e.target.value)}
        {...field.focusProps}
      />
    </div>
  );
}

// Phrased as prompts, not sample text, so an empty field never reads as filled in.
const DESCRIPTION_HINTS: Record<ItemType, string> = {
  item: "What happens during this part?",
  song: "Who starts, repeats, any key change?",
  header: "What this section is for",
  media: "What plays, and when to start it",
};

export function ItemPanel({
  planId,
  item,
  notes,
  files = [],
  onFilesChanged,
  startLabel,
  headers,
  currentHeaderId,
  onClose,
  onItemSaved,
  onNoteSaved,
  onEditLeaders,
  onChangeSong,
  onDuplicate,
  onMoveToHeader,
  onDelete,
  onError,
}: {
  planId: string;
  item: PlanItem;
  notes: PlanNote[];
  /** The item's files and, for a song, its song's files. */
  files?: PlanFile[];
  onFilesChanged: () => void;
  startLabel: string | null;
  headers: { id: string; title: string }[];
  currentHeaderId: string | null;
  onClose: () => void;
  onItemSaved: (patch: Partial<PlanItem>) => void;
  onNoteSaved: (category: NoteCategory, body: string) => void;
  onEditLeaders: () => void;
  onChangeSong: () => void;
  onDuplicate: () => void;
  onMoveToHeader: (headerId: string | null) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const title = useAutosavedField(item.title, (v) => updateItemAction(item.id, { title: v }), {
    onSaved: (v) => onItemSaved({ title: v }),
    onError,
  });
  const itemType = useAutosavedField<ItemType>(item.itemType, (v) => updateItemAction(item.id, { itemType: v }), {
    onSaved: (v) => onItemSaved({ itemType: v, ...(v === "header" ? { lengthSeconds: 0 } : {}), ...(v !== "song" ? { song: null } : {}) }),
    onError,
  });
  const length = useAutosavedField(item.lengthSeconds, (v) => updateItemAction(item.id, { lengthSeconds: v }), {
    onSaved: (v) => onItemSaved({ lengthSeconds: v }),
    onError,
  });
  const description = useAutosavedField(item.description ?? "", (v) => updateItemAction(item.id, { description: v }), {
    onSaved: (v) => onItemSaved({ description: v || null }),
    onError,
  });
  const mediaUrl = useAutosavedField(item.mediaUrl ?? "", (v) => updateItemAction(item.id, { mediaUrl: v }), {
    onSaved: (v) => onItemSaved({ mediaUrl: v || null }),
    onError,
  });
  const songKey = useAutosavedField(item.song?.key ?? "", (v) => updateItemAction(item.id, { songKey: v }), {
    onSaved: (v) => onItemSaved({ song: item.song ? { ...item.song, key: v || null } : null }),
    onError,
  });

  // The length box shows what was typed until it is a valid length.
  const [lengthText, setLengthText] = useState(formatDuration(item.lengthSeconds));
  const [lengthInvalid, setLengthInvalid] = useState(false);
  useEffect(() => setLengthText(formatDuration(length.value)), [length.value]);
  const setLength = (seconds: number) => {
    const next = Math.max(0, Math.min(86_400, seconds));
    setLengthInvalid(false);
    length.commit(next);
  };

  const [noteStates, setNoteStates] = useState<Partial<Record<NoteCategory, SaveState>>>({});
  const onNoteState = useRef((category: NoteCategory, state: SaveState) =>
    setNoteStates((all) => (all[category] === state ? all : { ...all, [category]: state })),
  ).current;

  const saveState = combineSaveStates([
    title.state,
    itemType.state,
    length.state,
    description.state,
    mediaUrl.state,
    songKey.state,
    ...Object.values(noteStates),
  ]);
  const isHeader = itemType.value === "header";
  const notesWithText = new Set(notes.filter((n) => n.body.trim()).map((n) => n.category));

  return (
    <aside
      aria-labelledby="item-panel-title"
      className="fixed inset-0 z-40 flex flex-col bg-card text-card-foreground lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[460px] lg:border-l lg:border-border lg:shadow-card-hover"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) onClose();
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Button variant="ghost" className="lg:hidden" onClick={onClose}>
          <ArrowLeft aria-hidden />
          Back to plan
        </Button>
        <h2
          id="item-panel-title"
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate font-heading text-lg font-bold focus:outline-none"
        >
          {title.value || "Item"}
        </h2>
        <span role="status" aria-live="polite" className="shrink-0 text-sm text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
        </span>
        <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={onClose} aria-label="Close item">
          <X aria-hidden />
        </Button>
      </header>

      <div className="min-h-0 flex-auto space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
        {startLabel && !isHeader && <p className="text-[15px] text-muted-foreground">Starts at {startLabel}</p>}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="item-title">Title</Label>
            <Input
              id="item-title"
              value={title.value}
              maxLength={200}
              onChange={(e) => title.onChange(e.target.value)}
              {...title.focusProps}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-type">Type</Label>
            <Select id="item-type" value={itemType.value} onChange={(e) => itemType.commit(e.target.value as ItemType)}>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {!isHeader && (
          <div className="space-y-2">
            <Label htmlFor="item-length">Length</Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setLength(length.value - 30)} aria-label="30 seconds shorter">
                <Minus aria-hidden />
              </Button>
              <Input
                id="item-length"
                value={lengthText}
                inputMode="numeric"
                className="w-28 text-center font-semibold tabular-nums"
                aria-describedby="item-length-help"
                aria-invalid={lengthInvalid || undefined}
                onChange={(e) => setLengthText(e.target.value)}
                onBlur={() => {
                  const parsed = parseDuration(lengthText);
                  if (parsed === null) {
                    setLengthInvalid(true);
                    return;
                  }
                  setLength(parsed);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <Button variant="outline" size="icon" onClick={() => setLength(length.value + 30)} aria-label="30 seconds longer">
                <Plus aria-hidden />
              </Button>
            </div>
            <p id="item-length-help" className={cn("text-sm", lengthInvalid ? "text-destructive" : "text-muted-foreground")}>
              {lengthInvalid ? "Type minutes and seconds, like 3:00." : "Minutes and seconds, like 3:00. Or pick:"}
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Set length in minutes">
              {QUICK_MINUTES.map((m) => (
                <Button
                  key={m}
                  variant={length.value === m * 60 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLength(m * 60)}
                >
                  {m} min
                </Button>
              ))}
            </div>
          </div>
        )}

        {!isHeader && (
          <div className="space-y-2">
            <Label htmlFor="item-description">What happens here</Label>
            <Textarea
              id="item-description"
              value={description.value}
              maxLength={4000}
              rows={3}
              placeholder={DESCRIPTION_HINTS[itemType.value]}
              onChange={(e) => description.onChange(e.target.value)}
              {...description.focusProps}
            />
          </div>
        )}

        {!isHeader && (
          <div className="space-y-2">
            <span className="block text-[15px] font-semibold">Leaders</span>
            <button
              type="button"
              onClick={onEditLeaders}
              className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-2 text-left hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LeaderChips leaders={item.leaders} max={5} />
              <span className="text-[15px] font-semibold text-primary dark:text-accent">Edit leaders</span>
            </button>
            {item.leaders.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {item.leaders.map((l) => (l.personId ? l.name : `Open: ${l.positionLabel ?? l.name}`)).join(", ")}
              </p>
            )}
          </div>
        )}

        {itemType.value === "song" && (
          <section className="space-y-3 rounded-2xl border border-border p-4" aria-labelledby="song-block-title">
            <div className="flex items-center gap-2">
              <Music aria-hidden className="size-5 text-primary dark:text-accent" />
              <h3 id="song-block-title" className="font-semibold">
                Song
              </h3>
            </div>
            {item.song ? (
              <div className="space-y-1 text-[15px]">
                <p className="font-semibold">{item.song.title}</p>
                {item.song.author && <p className="text-muted-foreground">{item.song.author}</p>}
                <p className="text-muted-foreground">
                  {[
                    item.song.arrangementName ? `Arrangement: ${item.song.arrangementName}` : null,
                    item.song.ccliNumber ? `CCLI ${item.song.ccliNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ) : (
              <p className="text-[15px] text-muted-foreground">No song from the library yet.</p>
            )}
            {item.song && (
              <div className="space-y-2">
                <Label htmlFor="item-song-key">Key for this service</Label>
                <Input
                  id="item-song-key"
                  value={songKey.value}
                  maxLength={8}
                  className="w-28"
                  placeholder="G"
                  onChange={(e) => songKey.onChange(e.target.value)}
                  {...songKey.focusProps}
                />
                <p className="text-sm text-muted-foreground">Changing the key here never changes the song in the library.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onChangeSong}>
                {item.song ? "Change song" : "Pick a song"}
              </Button>
              {item.song && (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/dashboard/plans/songs/${item.song.songId}`} />}
                >
                  Open chart and lyrics
                </Button>
              )}
            </div>
          </section>
        )}

        {itemType.value === "media" && (
          <div className="space-y-2">
            <Label htmlFor="item-media">Video or media link</Label>
            <Input
              id="item-media"
              type="url"
              value={mediaUrl.value}
              placeholder="https://"
              onChange={(e) => mediaUrl.onChange(e.target.value)}
              {...mediaUrl.focusProps}
            />
          </div>
        )}

        {!isHeader && (
          <ItemFiles
            itemId={item.id}
            songId={itemType.value === "song" ? (item.song?.songId ?? null) : null}
            files={files}
            onChanged={onFilesChanged}
          />
        )}

        {!isHeader && (
          <div className="space-y-2">
            <span className="block text-[15px] font-semibold">Notes</span>
            <Tabs defaultValue="general">
              <TabsList aria-label="Note categories" className="max-w-full justify-start overflow-x-auto">
                {NOTE_CATEGORIES.map((c) => (
                  <TabsTrigger key={c} value={c} className="px-3">
                    {NOTE_CATEGORY_LABELS[c]}
                    {notesWithText.has(c) && <span aria-label="has a note" className="ml-1.5 size-2 rounded-full bg-accent" />}
                  </TabsTrigger>
                ))}
              </TabsList>
              {NOTE_CATEGORIES.map((c) => (
                <TabsContent key={c} value={c} keepMounted>
                  <NoteField
                    planId={planId}
                    itemId={item.id}
                    category={c}
                    note={notes.find((n) => n.category === c)}
                    onSaved={onNoteSaved}
                    onState={onNoteState}
                    onError={onError}
                  />
                </TabsContent>
              ))}
            </Tabs>
            <p className="text-sm text-muted-foreground">
              Each team sees only the note categories set for it under Teams and positions.
            </p>
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-5">
          {headers.length > 0 && !isHeader && (
            <div className="space-y-2">
              <Label htmlFor="item-move">Section</Label>
              <Select
                id="item-move"
                value={currentHeaderId ?? ""}
                onChange={(e) => onMoveToHeader(e.target.value || null)}
              >
                <option value="">Top of the plan</option>
                {headers.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onDuplicate}>
              <Copy aria-hidden />
              Duplicate
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
