"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveChurchAppInfo } from "@/app/dashboard/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ChurchAppInfo } from "@/lib/queries/church-app-info";

export function ChurchAboutForm({
  initialAbout,
  canEdit,
}: {
  initialAbout: string;
  canEdit: boolean;
}) {
  const [about, setAbout] = useState(initialAbout);
  const [pending, startTransition] = useTransition();

  const dirty = about !== initialAbout;

  function save() {
    if (!canEdit || !dirty) return;
    
    startTransition(async () => {
      // Note: saveChurchAppInfo expects full ChurchAppInfo, 
      // so this is a simplified version. Full implementation would
      // fetch current data, merge changes, and save.
      toast.info("About section saving - full implementation pending");
      // const result = await saveChurchAppInfo({ ...currentData, about });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Label htmlFor="about">About your church</Label>
        <Textarea
          id="about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Tell people what your church is about, your mission, and what you believe..."
          rows={8}
          disabled={!canEdit || pending}
        />
        <p className="text-sm text-muted-foreground">
          This appears on your church's page in the FaithForm app and helps people learn about your community.
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
