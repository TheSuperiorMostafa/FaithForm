"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, FileUp, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { importPreviewAction, importSaveAction, type ImportFileSummary } from "@/app/dashboard/plans/songs/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SUPPORTED_EXTENSIONS } from "@/lib/service-plans/songs/parsers";
import {
  SONG_FILE_FORMAT_LABELS,
  type ImportPreviewSong,
  type ImportSongInput,
} from "@/lib/service-plans/songs/types";
import { cn } from "@/lib/utils";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 1024 * 1024;
// Server Actions accept 4 MB a request, and saving sends each song's chart
// and lyrics (about twice the file), so keep one batch well under that.
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024;

function toInput(song: ImportPreviewSong): ImportSongInput {
  return {
    title: song.title,
    author: song.author,
    ccliNumber: song.ccliNumber,
    copyright: song.copyright,
    key: song.key,
    tempo: song.tempo,
    tags: song.tags,
    themes: song.themes,
    sectionOrder: song.sectionOrder,
    chartText: song.chartText,
    lyrics: song.lyrics,
    format: song.format,
  };
}

/** Pick files, review what was found, then save the songs kept. */
export function SongImporter() {
  const router = useRouter();
  const [songs, setSongs] = useState<ImportPreviewSong[] | null>(null);
  const [files, setFiles] = useState<ImportFileSummary[]>([]);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, startRead] = useTransition();
  const [saving, startSave] = useTransition();

  const read = (list: FileList | File[]) => {
    const chosen = Array.from(list);
    if (!chosen.length) return;
    setError(null);
    if (chosen.length > MAX_FILES) {
      setError(`Choose up to ${MAX_FILES} files at a time.`);
      return;
    }
    const total = chosen.reduce((sum, f) => sum + (f.size <= MAX_FILE_BYTES ? f.size : 0), 0);
    if (total > MAX_TOTAL_BYTES) {
      setError("Those files add up to more than 1.5 MB. Choose fewer files at a time.");
      return;
    }
    startRead(async () => {
      const tooBig = chosen.filter((f) => f.size > MAX_FILE_BYTES);
      const payload = await Promise.all(
        chosen.filter((f) => f.size <= MAX_FILE_BYTES).map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      if (!payload.length) {
        setError("Those files are too large to be song files. Song files are usually a few kilobytes.");
        return;
      }
      const result = await importPreviewAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSongs(result.songs);
      setFiles([
        ...result.files,
        ...tooBig.map((f) => ({ name: f.name, format: null, songCount: 0, warnings: ["This file is too large to read."] })),
      ]);
      setKept(new Set(result.songs.filter((s) => !s.duplicate).map((s) => s.previewId)));
    });
  };

  const reset = () => {
    setSongs(null);
    setFiles([]);
    setKept(new Set());
    setError(null);
  };

  const keptSongs = useMemo(() => (songs ?? []).filter((s) => kept.has(s.previewId)), [songs, kept]);
  const problemFiles = files.filter((f) => f.warnings.length > 0 || f.songCount === 0);

  const save = () =>
    startSave(async () => {
      const result = await importSaveAction(keptSongs.map(toInput));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Added ${result.added} ${result.added === 1 ? "song" : "songs"} to your song library.`);
      router.push("/dashboard/plans/songs");
    });

  const toggle = (id: string) =>
    setKept((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!songs) {
    return (
      <section aria-labelledby="import-pick-title" className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!reading) read(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-border bg-card/60 px-6 py-12 text-center transition-colors",
            dragging && "border-accent bg-accent/[0.06]",
          )}
        >
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
          >
            <FileUp className="size-8" strokeWidth={1.5} />
          </span>
          <div className="max-w-lg space-y-1.5">
            <h2 id="import-pick-title" className="font-heading text-xl font-bold text-foreground">
              Choose song files
            </h2>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              ChordPro, OnSong, SongSelect downloads (.usr or the lyrics .txt) and spreadsheets (.csv with a Title
              column). You can pick many at once, or drag them here. You’ll check every song before anything is saved.
            </p>
          </div>
          <label
            htmlFor="song-import-files"
            className={cn(
              buttonVariants({ size: "lg" }),
              "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              reading && "pointer-events-none opacity-50",
            )}
          >
            <FileUp aria-hidden className="size-5" />
            {reading ? "Reading files…" : "Choose files"}
            <input
              id="song-import-files"
              type="file"
              multiple
              accept={SUPPORTED_EXTENSIONS.join(",")}
              className="sr-only"
              disabled={reading}
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                read(list);
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-[15px] text-destructive">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="import-review-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 id="import-review-title" className="font-heading text-xl font-bold text-foreground">
            Check the songs
          </h2>
          <p className="text-[15px] text-muted-foreground">
            Found {songs.length} {songs.length === 1 ? "song" : "songs"} in {files.length}{" "}
            {files.length === 1 ? "file" : "files"}. Untick any you don’t want. Songs already in your library start
            unticked.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setKept(new Set(songs.map((s) => s.previewId)))}>
            Tick all
          </Button>
          <Button variant="ghost" onClick={() => setKept(new Set())}>
            Untick all
          </Button>
        </div>
      </div>

      {problemFiles.length > 0 && (
        <div role="status" className="space-y-2 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 dark:border-orange-500/30 dark:bg-orange-500/10">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <AlertTriangle aria-hidden className="size-5 shrink-0 text-orange-600 dark:text-orange-300" />
            Some files need a look
          </p>
          <ul className="space-y-1 text-[15px] text-muted-foreground">
            {problemFiles.map((f) => (
              <li key={f.name}>
                <span className="font-semibold text-foreground">{f.name}:</span>{" "}
                {f.warnings.length ? f.warnings.join(" ") : "No songs were found in this file."}
              </li>
            ))}
          </ul>
        </div>
      )}

      {songs.length > 0 && (
        <ul aria-label="Songs found" className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {songs.map((song) => {
            const checked = kept.has(song.previewId);
            const inputId = `import-${song.previewId}`;
            return (
              <li key={song.previewId} className="flex items-start gap-4 rounded-2xl px-3 py-3 sm:px-4">
                <label htmlFor={inputId} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(song.previewId)}
                    className="size-5 accent-primary"
                    aria-describedby={`${inputId}-details`}
                  />
                  <span className="sr-only">Import {song.title}</span>
                </label>
                <div className="min-w-0 flex-1 space-y-1 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={inputId} className="cursor-pointer text-base font-semibold text-foreground">
                      {song.title}
                    </label>
                    {song.duplicate && (
                      <StatusBadge tone="attention">
                        {song.duplicate.inFile ? "Also in this upload" : "Already in your library"}
                      </StatusBadge>
                    )}
                  </div>
                  <p id={`${inputId}-details`} className="text-[15px] text-muted-foreground">
                    {[
                      song.author,
                      song.key ? `Key of ${song.key}` : null,
                      song.ccliNumber ? `CCLI ${song.ccliNumber}` : null,
                      song.sections.length
                        ? `${song.sections.length} ${song.sections.length === 1 ? "section" : "sections"}`
                        : null,
                      `${SONG_FILE_FORMAT_LABELS[song.format]} · ${song.fileName}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {song.duplicate && !song.duplicate.inFile && song.duplicate.songId && (
                    <p className="text-sm text-muted-foreground">
                      Matches{" "}
                      <Link
                        href={`/dashboard/plans/songs/${song.duplicate.songId}`}
                        className="font-semibold text-primary underline underline-offset-4 dark:text-accent"
                        target="_blank"
                      >
                        {song.duplicate.title}
                      </Link>{" "}
                      by {song.duplicate.reason === "ccli" ? "CCLI number" : "title"}.
                    </p>
                  )}
                  {song.warnings.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                      {song.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <Button variant="outline" size="lg" onClick={reset} disabled={saving}>
          <RotateCcw aria-hidden className="size-5" />
          Choose different files
        </Button>
        <Button size="lg" onClick={save} disabled={saving || keptSongs.length === 0}>
          <Save aria-hidden className="size-5" />
          {saving
            ? "Saving…"
            : keptSongs.length === 0
              ? "Save songs"
              : `Save ${keptSongs.length} ${keptSongs.length === 1 ? "song" : "songs"}`}
        </Button>
      </div>
    </section>
  );
}
