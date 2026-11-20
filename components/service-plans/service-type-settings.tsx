"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { archiveServiceTypeAction, updateServiceTypeAction } from "@/app/dashboard/plans/actions";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { undoToast } from "@/lib/ui/undo-toast";
import { WEEKDAY_NAMES } from "@/lib/service-plans/timing";
import type { ServiceType, ServiceTypeTime, TimeKind } from "@/lib/service-plans/types";

type DraftTime = Omit<ServiceTypeTime, "id"> & { key: string };

const KIND_LABELS: Record<TimeKind, string> = { service: "Service", rehearsal: "Rehearsal", other: "Other" };

export function ServiceTypeSettings({
  type,
  templates,
}: {
  type: ServiceType;
  templates: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(type.name);
  const [weekday, setWeekday] = useState(String(type.defaultWeekday ?? 0));
  const [target, setTarget] = useState(type.targetSeconds ? String(type.targetSeconds / 60) : "");
  const [templateId, setTemplateId] = useState(type.defaultTemplateId ?? "");
  const [times, setTimes] = useState<DraftTime[]>(
    type.times.map((t) => ({ kind: t.kind, label: t.label, weekday: t.weekday, localTime: t.localTime, key: t.id })),
  );

  const updateTime = (key: string, patch: Partial<DraftTime>) =>
    setTimes((all) => all.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await updateServiceTypeAction(type.id, {
        name,
        defaultWeekday: Number(weekday),
        targetMinutes: target ? Number(target) : null,
        defaultTemplateId: templateId || null,
        times: times.map(({ kind, label, weekday: w, localTime }) => ({ kind, label, weekday: w, localTime })),
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${name.trim()} settings saved. New plans use these times.`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <Card className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="type-name">Name</Label>
          <Input id="type-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type-weekday">Usual day</Label>
          <Select id="type-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {WEEKDAY_NAMES.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="type-target">Target length (minutes)</Label>
          <Input
            id="type-target"
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="75"
            aria-describedby="type-target-help"
          />
          <p id="type-target-help" className="text-sm text-muted-foreground">
            The plan’s footer turns amber when it runs longer.
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="type-template">New plans start from</Label>
          <Select id="type-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">No default template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <h2 className="font-heading text-lg font-bold">Default times</h2>
          <p className="text-[15px] text-muted-foreground">
            Every new plan gets these. A Saturday rehearsal lands on the day before a Sunday plan.
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {times.map((t, index) => (
            <li key={t.key} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor={`time-kind-${t.key}`}>Kind</Label>
                <Select
                  id={`time-kind-${t.key}`}
                  value={t.kind}
                  onChange={(e) => updateTime(t.key, { kind: e.target.value as TimeKind })}
                >
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`time-label-${t.key}`}>Label</Label>
                <Input
                  id={`time-label-${t.key}`}
                  value={t.label}
                  maxLength={60}
                  onChange={(e) => updateTime(t.key, { label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`time-day-${t.key}`}>Day</Label>
                <Select
                  id={`time-day-${t.key}`}
                  value={t.weekday}
                  onChange={(e) => updateTime(t.key, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAY_NAMES.map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`time-at-${t.key}`}>Time</Label>
                <TimePicker
                  id={`time-at-${t.key}`}
                  value={t.localTime}
                  onChange={(v) => updateTime(t.key, { localTime: v })}
                  step={15}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTimes((all) => all.filter((_, i) => i !== index))}
                aria-label={`Remove ${t.label || "this time"}`}
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() =>
            setTimes((all) => [
              ...all,
              { key: crypto.randomUUID(), kind: "service", label: "Service", weekday: Number(weekday), localTime: "11:00" },
            ])
          }
        >
          <Plus aria-hidden />
          Add a time
        </Button>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>

      <AdvancedSection title="Archive this service type">
        <p className="mb-3 text-[15px] text-muted-foreground">
          Hides {type.name} from Service Plans. Its plans and templates are kept, and you can undo.
        </p>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await archiveServiceTypeAction(type.id, true);
              if (!result.ok) return void toast.error(result.error);
              router.push("/dashboard/plans?home=1");
              undoToast(`${type.name} archived.`, async () => {
                const undo = await archiveServiceTypeAction(type.id, false);
                router.refresh();
                return undo.ok ? undefined : undo.error;
              });
            })
          }
        >
          Archive {type.name}
        </Button>
      </AdvancedSection>
    </form>
  );
}
