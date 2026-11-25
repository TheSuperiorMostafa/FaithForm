"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, BookOpen, FileSpreadsheet, Music, PencilLine, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  addSongFromCatalogAction,
  createSongAction,
  searchCatalogAction,
  seedStarterHymnsAction,
  type CatalogResult,
} from "@/app/dashboard/plans/songs/actions";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { catalogQuery } from "@/lib/service-plans/songs/catalog";
import { KeySelect } from "@/components/service-plans/songs/key-select";

/**
 * "Add song": search the shared catalog by title or CCLI number and pick the
 * song, so its title, writers and CCLI number come in without typing. When it
 * isn't there, add it by hand; lyrics, charts and files go on the song's page.
 */
export function AddSongButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"search" | "manual">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const request = useRef(0);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [ccli, setCcli] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || mode !== "search") return;
    const id = ++request.current;
    const text = query.trim();
    if (!text) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const result = await searchCatalogAction(text);
      if (id !== request.current) return;
      setSearching(false);
      if (!result.ok) {
        setSearchError(result.error);
        setResults([]);
        return;
      }
      setSearchError(null);
      setResults(result.songs);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, mode, query]);

  const pick = (song: CatalogResult) => {
    if (song.librarySongId) {
      setOpen(false);
      router.push(`/dashboard/plans/songs/${song.librarySongId}`);
      return;
    }
    startAdding(async () => {
      const result = await addSongFromCatalogAction(song.id);
      if (!result.ok) {
        setSearchError(result.error);
        return;
      }
      toast.success(
        result.existing ? `“${song.title}” is already in your song library.` : `“${song.title}” added to your song library.`,
      );
      setOpen(false);
      router.push(`/dashboard/plans/songs/${result.id}`);
    });
  };

  const addByHand = () => {
    const text = query.trim();
    const number = catalogQuery(text).ccli ?? "";
    setTitle(number ? "" : text);
    setCcli(number);
    setError(null);
    setMode("manual");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await createSongAction({ title, author, ccliNumber: ccli, defaultKey: key });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`“${title.trim()}” added to your song library.`);
      setOpen(false);
      router.push(`/dashboard/plans/songs/${result.id}`);
    });
  };

  return (
    <>
      <Button
        size="lg"
        variant={variant}
        onClick={() => {
          setMode("search");
          setQuery("");
          setResults([]);
          setSearchError(null);
          setTitle("");
          setAuthor("");
          setCcli("");
          setKey("");
          setError(null);
          setOpen(true);
        }}
      >
        <Plus aria-hidden className="size-5" />
        Add song
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          {mode === "search" ? (
            <>
              <DialogHeader>
                <DialogTitle>Add a song</DialogTitle>
                <DialogDescription>
                  Search by title or CCLI song number. The title, writers and CCLI number come in for you.
                </DialogDescription>
              </DialogHeader>
              <div className="shrink-0 border-b border-border px-6 py-4">
                <Label htmlFor="catalog-search" className="sr-only">
                  Song title or CCLI number
                </Label>
                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="catalog-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Song title or CCLI number"
                    autoComplete="off"
                    autoFocus
                    className="pl-11"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-auto overflow-y-auto px-3 py-3" aria-busy={searching || adding}>
                {searching && results.length === 0 ? (
                  <ul aria-hidden className="space-y-1">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <li key={i} className="flex min-h-[64px] items-center gap-3 px-3 py-2">
                        <Skeleton className="size-10 shrink-0 rounded-xl" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Skeleton className="h-4 w-48 max-w-full" />
                          <Skeleton className="h-3.5 w-32 max-w-full" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : searchError ? (
                  <p role="alert" className="px-3 py-6 text-center text-[15px] text-destructive">
                    {searchError}
                  </p>
                ) : !query.trim() ? (
                  <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">
                    Type a title, or the CCLI song number from SongSelect.
                  </p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">
                    No songs in the catalog match “{query.trim()}”. You can add it yourself.
                  </p>
                ) : (
                  <ul aria-label="Songs in the catalog" className="space-y-1">
                    {results.map((song) => (
                      <li key={song.id}>
                        <button
                          type="button"
                          onClick={() => pick(song)}
                          disabled={adding}
                          className="flex min-h-[64px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          <span
                            aria-hidden
                            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] font-heading text-sm font-bold text-primary dark:bg-accent/15 dark:text-accent"
                          >
                            {song.defaultKey ?? <Music className="size-4" strokeWidth={1.75} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold text-foreground">{song.title}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {[song.author, song.ccliNumber ? `CCLI ${song.ccliNumber}` : null, song.isPublicDomain ? "Public domain" : null]
                                .filter(Boolean)
                                .join(" · ") || "No writer listed"}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-primary dark:text-accent">
                            {song.librarySongId ? "Open" : "Add"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={addByHand}>
                  <PencilLine aria-hidden className="size-5" />
                  Add it yourself
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
              <DialogHeader>
                <DialogTitle>Add a song yourself</DialogTitle>
                <DialogDescription>
                  Start with the title. Next you can paste the lyrics or chord chart, or upload your own file.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-auto space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-2">
                  <Label htmlFor="new-song-title">Title</Label>
                  <Input
                    id="new-song-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    maxLength={200}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-song-author">Writers (optional)</Label>
                  <Input id="new-song-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={300} />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-song-ccli">CCLI song number (optional)</Label>
                    <Input
                      id="new-song-ccli"
                      value={ccli}
                      onChange={(e) => setCcli(e.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]{1,10}"
                      maxLength={10}
                      aria-describedby="new-song-ccli-help"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-song-key">Key (optional)</Label>
                    <KeySelect id="new-song-key" value={key} onChange={setKey} />
                  </div>
                </div>
                <p id="new-song-ccli-help" className="text-sm text-muted-foreground">
                  With a CCLI number, the title and writers (never the words) are added to the shared catalog so other
                  churches can find the song.
                </p>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setMode("search")}>
                  <ArrowLeft aria-hidden className="size-5" />
                  Back to search
                </Button>
                <Button type="submit" disabled={pending || !title.trim()}>
                  {pending ? "Adding…" : "Add song"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Adds the public-domain starter hymns the library is offered when empty. */
export function StarterHymnsButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await seedStarterHymnsAction();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(
            result.added
              ? `Added ${result.added} classic hymns to your song library.`
              : "These hymns are already in your song library.",
          );
          router.refresh();
        })
      }
    >
      <BookOpen aria-hidden className="size-5" />
      {pending ? "Adding hymns…" : `Add ${count} classic hymns`}
    </Button>
  );
}

/** Downloads the songs sung between two dates, for the CCLI report. */
export function UsageReportButton({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const valid = Boolean(from && to && from <= to);
  const href = `/api/dashboard/plans/songs/usage?${new URLSearchParams({ from, to }).toString()}`;

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <FileSpreadsheet aria-hidden className="size-5" />
        Usage report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Song usage report</DialogTitle>
            <DialogDescription>
              A spreadsheet of every song in your plans between these dates, with writers and CCLI numbers, for your
              CCLI report.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-auto space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="usage-from">From</Label>
                <DatePicker id="usage-from" value={from} onChange={setFrom} max={to || undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usage-to">To</Label>
                <DatePicker id="usage-to" value={to} onChange={setTo} min={from || undefined} />
              </div>
            </div>
            {!valid && (
              <p role="alert" className="text-sm text-destructive">
                Choose a start date on or before the end date.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {valid ? (
              <Button nativeButton={false} render={<a href={href} download onClick={() => setOpen(false)} />}>
                <FileSpreadsheet aria-hidden className="size-5" />
                Download spreadsheet
              </Button>
            ) : (
              <Button disabled>
                <FileSpreadsheet aria-hidden className="size-5" />
                Download spreadsheet
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
