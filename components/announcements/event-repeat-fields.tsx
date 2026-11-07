"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EventRepeat } from "@/lib/announcements/recurrence";

export function EventRepeatFields({ id, repeat, until, onRepeat, onUntil }: {
  id: string; repeat: EventRepeat; until: string;
  onRepeat: (value: EventRepeat) => void; onUntil: (value: string) => void;
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2">
      <Label htmlFor={`${id}-repeat`}>Repeat</Label>
      <select id={`${id}-repeat`} value={repeat} onChange={(event) => onRepeat(event.target.value as EventRepeat)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base">
        <option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
      </select>
    </div>
    {repeat !== "none" && <div className="space-y-2"><Label htmlFor={`${id}-until`}>Last date</Label><Input id={`${id}-until`} type="date" required value={until} onChange={(event) => onUntil(event.target.value)} /></div>}
  </div>;
}
