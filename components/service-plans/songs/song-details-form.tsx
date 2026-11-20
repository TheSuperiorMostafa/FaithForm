"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, Save } from "lucide-react";
import { toast } from "sonner";
import { archiveSongAction, restoreSongAction, updateSongAction } from "@/app/dashboard/plans/songs/actions";
import { KeySelect } from "@/components/service-plans/songs/key-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { undoToast } from "@/lib/ui/undo-toast";
import type { SongDetail } from "@/lib/service-plans/songs/types";

type Props = Pick<SongDetail, "id" | "title" | "author" | "ccliNumber" | "copyright" | "defaultKey" | "tempo" | "tags">;

export function SongDetailsForm({ song }: { song: Props }) {
  const router = useRouter();
  const [title, setTitle] = useState(song.title);
  const [author, setAuthor] = useState(song.author ?? "");
  const [ccli, setCcli] = useState(song.ccliNumber ?? "");
  const [copyright, setCopyright] = useState(song.copyright ?? "");
  const [key, setKey] = useState(song.defaultKey ?? "");
  const [tempo, setTempo] = useState(song.tempo ? String(song.tempo) : "");
  const [tags, setTags] = useState(song.tags.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [removing, startRemove] = useTransition();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startSave(async () => {
      const result = await updateSongAction(song.id, {
        title,
        author,
        ccliNumber: ccli,
        copyright,
        defaultKey: key,
        tempo: tempo.trim() ? Number(tempo) : null,
        tags: tags.split(","),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Saved the details for “${title.trim()}”.`);
      router.refresh();
    });
  };

  const remove = () =>
    startRemove(async () => {
      const result = await archiveSongAction(song.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      undoToast(
        `“${song.title}” removed from your song library. Plans that used it keep it.`,
        async () => {
          const undo = await restoreSongAction(song.id);
          if (!undo.ok) return undo.error;
          router.refresh();
        },
        { undoneMessage: `“${song.title}” is back in your song library.` },
      );
      router.push("/dashboard/plans/songs");
    });

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="song-title">Title</Label>
          <Input id="song-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="song-author">Writers</Label>
          <Input id="song-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={300} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-ccli">CCLI song number</Label>
          <Input
            id="song-ccli"
            value={ccli}
            onChange={(e) => setCcli(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]{1,10}"
            maxLength={10}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-copyright">Copyright</Label>
          <Input
            id="song-copyright"
            value={copyright}
            onChange={(e) => setCopyright(e.target.value)}
            maxLength={500}
            placeholder="Public Domain"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-key">Usual key</Label>
          <KeySelect id="song-key" value={key} onChange={setKey} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-tempo">Tempo (BPM)</Label>
          <Input
            id="song-tempo"
            type="number"
            min={20}
            max={300}
            step={1}
            value={tempo}
            onChange={(e) => setTempo(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="song-tags">Tags</Label>
          <Input
            id="song-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Hymn, Christmas, Communion"
            aria-describedby="song-tags-help"
          />
          <p id="song-tags-help" className="text-sm text-muted-foreground">
            Separate tags with commas.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={remove} disabled={removing}>
          <Archive aria-hidden className="size-5" />
          {removing ? "Removing…" : "Remove from library"}
        </Button>
        <Button type="submit" disabled={saving || !title.trim()}>
          <Save aria-hidden className="size-5" />
          {saving ? "Saving…" : "Save song details"}
        </Button>
      </div>
    </form>
  );
}
