"use client";

import { useState } from "react";
import { Calendar, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type AvailabilityOption = "available" | "limited" | "unavailable" | null;

export function AvailabilityForm({
  groupId,
  groupName,
  currentAvailability,
  onUpdate,
}: {
  groupId: string;
  groupName: string;
  currentAvailability: string | null;
  onUpdate: (availability: string | null) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [availability, setAvailability] = useState<AvailabilityOption>(
    currentAvailability as AvailabilityOption
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const options: Array<{ value: AvailabilityOption; label: string; description: string }> = [
    {
      value: "available",
      label: "Available",
      description: "I can help with events and activities",
    },
    {
      value: "limited",
      label: "Limited",
      description: "I can help occasionally or with specific needs",
    },
    {
      value: "unavailable",
      label: "Unavailable",
      description: "I'm not available to volunteer right now",
    },
    {
      value: null,
      label: "Not set",
      description: "Haven't specified my availability",
    },
  ];

  async function handleSave() {
    setBusy(true);
    const value = availability ? `${availability}${notes ? `: ${notes}` : ""}` : null;
    const result = await onUpdate(value);
    setBusy(false);

    if (result.ok) {
      toast.success("Availability updated");
    } else {
      toast.error(result.error || "Failed to update availability");
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <div className="mb-6 flex items-start gap-3">
        <Calendar className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <h3 className="text-[17px] font-semibold">Your Availability</h3>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Let {groupName} leaders know when you can volunteer
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-3">
          {options.map((option) => (
            <label
              key={option.value || "none"}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                availability === option.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="mt-0.5 flex size-5 items-center justify-center rounded-full border-2 border-current">
                {availability === option.value && (
                  <div className="size-2.5 rounded-full bg-current" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-medium">{option.label}</span>
                  {availability === option.value && (
                    <Check className="size-4 text-primary" />
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <input
                type="radio"
                name="availability"
                value={option.value || ""}
                checked={availability === option.value}
                onChange={() => setAvailability(option.value)}
                className="sr-only"
              />
            </label>
          ))}
        </div>

        {availability && availability !== "unavailable" && (
          <div className="space-y-2">
            <Label htmlFor="availability-notes">
              Additional notes (optional)
            </Label>
            <textarea
              id="availability-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Available weekends only, prefer setup roles..."
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        <Button onClick={handleSave} disabled={busy} className="w-full">
          Save availability
        </Button>
      </div>
    </div>
  );
}
