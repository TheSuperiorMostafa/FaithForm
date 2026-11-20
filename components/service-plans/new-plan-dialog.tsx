"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createPlanAction, type PlanSource } from "@/app/dashboard/plans/actions";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { formatPlanDate } from "@/lib/service-plans/timing";

type SourceKind = PlanSource["kind"];

export function NewPlanButton({
  serviceTypeId,
  defaultDate,
  templates,
  defaultTemplateId,
  recentPlans,
}: {
  serviceTypeId: string;
  defaultDate: string;
  templates: { id: string; title: string }[];
  defaultTemplateId: string | null;
  recentPlans: { id: string; date: string; title: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initialKind: SourceKind = templates.length ? "template" : recentPlans.length ? "copy" : "blank";
  const [kind, setKind] = useState<SourceKind>(initialKind);
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? templates[0]?.id ?? "");
  const [copyId, setCopyId] = useState(recentPlans[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const options = [
    ...(templates.length ? [{ value: "template" as const, label: "From a template" }] : []),
    ...(recentPlans.length ? [{ value: "copy" as const, label: "Copy a plan" }] : []),
    { value: "blank" as const, label: "Blank" },
  ];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const source: PlanSource =
      kind === "template" ? { kind, id: templateId } : kind === "copy" ? { kind, id: copyId } : { kind: "blank" };
    start(async () => {
      const result = await createPlanAction({ serviceTypeId, date, title: title || null, source });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Plan for ${formatPlanDate(date)} created.`);
      setOpen(false);
      router.push(`/dashboard/plans/${serviceTypeId}/${result.id}`);
    });
  };

  return (
    <>
      <Button
        size="lg"
        onClick={() => {
          setKind(initialKind);
          setDate(defaultDate);
          setError(null);
          setOpen(true);
        }}
      >
        <Plus aria-hidden className="size-5" />
        New plan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
            <DialogHeader>
              <DialogTitle>New plan</DialogTitle>
              <DialogDescription>Pick the date and where the order of service comes from.</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-auto space-y-5 overflow-y-auto px-6 py-5">
              <div className="space-y-2">
                <Label htmlFor="new-plan-date">Date</Label>
                <DatePicker id="new-plan-date" value={date} onChange={setDate} required />
              </div>
              <SegmentedControl label="Start from" value={kind} options={options} onChange={setKind} />
              {kind === "template" && (
                <div className="space-y-2">
                  <Label htmlFor="new-plan-template">Template</Label>
                  <Select id="new-plan-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.id === defaultTemplateId ? " (default)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {kind === "copy" && (
                <div className="space-y-2">
                  <Label htmlFor="new-plan-copy">Plan to copy</Label>
                  <Select id="new-plan-copy" value={copyId} onChange={(e) => setCopyId(e.target.value)}>
                    {recentPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatPlanDate(p.date, "short")}
                        {p.title ? ` · ${p.title}` : ""}
                      </option>
                    ))}
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Items, lengths, leaders and notes are copied. Who serves and their answers start fresh.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-plan-title">Title (optional)</Label>
                <Input
                  id="new-plan-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Easter Sunday"
                  maxLength={120}
                />
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
              <Button type="submit" disabled={pending || !date}>
                {pending ? "Creating…" : "Create plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
