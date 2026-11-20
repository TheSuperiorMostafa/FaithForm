"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookOpen, FileSpreadsheet, Plus } from "lucide-react";
import { toast } from "sonner";
import { createSongAction, seedStarterHymnsAction } from "@/app/dashboard/plans/songs/actions";
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
import { KeySelect } from "@/components/service-plans/songs/key-select";

/** "Add song": the few facts needed to start, then the song's own page. */
export function AddSongButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [ccli, setCcli] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
        <DialogContent>
          <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
            <DialogHeader>
              <DialogTitle>Add a song</DialogTitle>
              <DialogDescription>Start with the title. You can add the chord chart and files next.</DialogDescription>
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
                    placeholder="22025"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-song-key">Key (optional)</Label>
                  <KeySelect id="new-song-key" value={key} onChange={setKey} />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? "Adding…" : "Add song"}
              </Button>
            </DialogFooter>
          </form>
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
