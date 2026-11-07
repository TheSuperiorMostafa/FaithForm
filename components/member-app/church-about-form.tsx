"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveChurchAppInfo } from "@/app/dashboard/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ChurchAppInfo } from "@/lib/queries/church-app-info";

export function ChurchAboutForm({
  initialDescription,
  initialMission,
  canEdit,
}: {
  initialDescription: string;
  initialMission: string;
  canEdit: boolean;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [mission, setMission] = useState(initialMission);
  const [pending, startTransition] = useTransition();

  const dirty = description !== initialDescription || mission !== initialMission;

  function save() {
    if (!canEdit || !dirty) return;
    
    startTransition(async () => {
      const result = await saveChurchAppInfo({ description, mission } as Partial<ChurchAppInfo>);
      if (result.ok) {
        toast.success("About section updated");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Label htmlFor="description">Church description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell people what your church is about..."
          rows={4}
          disabled={!canEdit || pending}
        />
        <p className="text-sm text-muted-foreground">
          A brief overview of your church that appears in your church app profile.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mission">Mission & beliefs</Label>
        <Textarea
          id="mission"
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          placeholder="What your church believes and stands for..."
          rows={6}
          disabled={!canEdit || pending}
        />
        <p className="text-sm text-muted-foreground">
          Your church's mission statement and core beliefs.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {dirty && (
            <p className="text-sm text-muted-foreground">You have unsaved changes</p>
          )}
        </div>
        <Button
          onClick={save}
          disabled={!canEdit || !dirty || pending}
        >
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
