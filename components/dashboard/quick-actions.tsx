"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Megaphone, Minus, Phone, Plus, UserCheck } from "lucide-react";
import { saveWeeklyInputs } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type QuickActionsProps = {
  churchId: string;
  initialFollowUps?: number;
  initialPhoneCalls?: number;
};

type CounterCardProps = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  onChange: (value: number) => void;
};

function CounterCard({ label, icon: Icon, value, onChange }: CounterCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          {label}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onChange(Math.max(0, value - 1))}
            aria-label={`Decrease ${label}`}
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-[2ch] text-center text-2xl font-bold tabular-nums">
            {value}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onChange(value + 1)}
            aria-label={`Increase ${label}`}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function QuickActions({
  initialFollowUps = 0,
  initialPhoneCalls = 0,
}: QuickActionsProps) {
  const [followUps, setFollowUps] = useState(initialFollowUps);
  const [phoneCalls, setPhoneCalls] = useState(initialPhoneCalls);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const handleSave = () => {
    const formData = new FormData();
    formData.set("follow_ups", String(followUps));
    formData.set("phone_calls", String(phoneCalls));

    startTransition(async () => {
      const result = await saveWeeklyInputs(formData);
      if (result?.error) {
        setMessage(result.error);
      } else {
        setMessage("Saved");
        setTimeout(() => setMessage(null), 2000);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <CounterCard
          label="Follow-ups"
          icon={UserCheck}
          value={followUps}
          onChange={setFollowUps}
        />
        <CounterCard
          label="Phone calls"
          icon={Phone}
          value={phoneCalls}
          onChange={setPhoneCalls}
        />
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Megaphone className="size-4" aria-hidden />
              Announcements
            </div>
            <p className="text-sm text-muted-foreground">
              Create and schedule announcements with start and end times.
            </p>
            <Link href="/dashboard/announcements/new" className="w-full">
              <Button variant="outline" className="w-full">
                New announcement
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save weekly inputs"}
        </Button>
        {message && (
          <span className="text-sm text-muted-foreground">{message}</span>
        )}
      </div>
    </div>
  );
}
