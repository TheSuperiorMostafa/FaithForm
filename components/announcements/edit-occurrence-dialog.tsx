"use client";

import { useState } from "react";
import { Edit2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { editRecurringOccurrence } from "@/app/dashboard/announcements/recurring-actions";

type Occurrence = {
  id: string;
  occurrence_date: string;
  start_at: string;
  end_at: string | null;
  override_title: string | null;
  override_description: string | null;
  override_location: string | null;
};

export function EditOccurrenceDialog({
  occurrence,
  baseTitle,
  onSuccess,
}: {
  occurrence: Occurrence;
  baseTitle: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(occurrence.override_title || "");
  const [description, setDescription] = useState(occurrence.override_description || "");
  const [location, setLocation] = useState(occurrence.override_location || "");

  async function handleSave() {
    setSaving(true);

    const result = await editRecurringOccurrence(occurrence.id, {
      title: title.trim() || null,
      description: description.trim() || null,
      location: location.trim() || null,
    });

    setSaving(false);

    if (result.ok) {
      toast.success("Occurrence updated");
      setOpen(false);
      onSuccess();
    } else {
      toast.error(result.error);
    }
  }

  const date = new Date(occurrence.occurrence_date);
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" title="Edit this occurrence">
          <Edit2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Occurrence</DialogTitle>
          <DialogDescription>
            Customize this specific occurrence on {dateLabel}. Leave fields empty to use the default values from
            &ldquo;{baseTitle}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Default: ${baseTitle}`}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Custom description for this occurrence"
              rows={4}
              maxLength={4000}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (optional)</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Custom location for this occurrence"
              maxLength={200}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
