"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileStack, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { createTemplateAction, deletePlanAction, updateServiceTypeAction } from "@/app/dashboard/plans/actions";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListRow } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDuration } from "@/lib/service-plans/timing";

export function TemplatesList({
  serviceTypeId,
  templates,
  defaultTemplateId,
}: {
  serviceTypeId: string;
  templates: { id: string; title: string; itemCount: number; totalSeconds: number }[];
  defaultTemplateId: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await createTemplateAction(serviceTypeId, name);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`Template ${name.trim()} created. Add its items now.`);
      router.push(`/dashboard/plans/${serviceTypeId}/${result.id}`);
    });
  };

  const makeDefault = (id: string, title: string) =>
    start(async () => {
      const result = await updateServiceTypeAction(serviceTypeId, { defaultTemplateId: id });
      if (!result.ok) return void toast.error(result.error);
      toast.success(`New plans now start from ${title}.`);
      router.refresh();
    });

  const remove = async (id: string, title: string) => {
    const ok = await confirmAction({
      title: `Delete the ${title} template?`,
      description: "Plans already made from it stay as they are. This can't be undone.",
      confirmLabel: "Delete template",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const result = await deletePlanAction(id);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${title} deleted.`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {templates.length === 0 ? (
        <EmptyState
          compact
          icon={FileStack}
          title="No templates yet"
          description="A template is an order of service new plans start from. Make one here, or open a plan and choose Save as template."
        />
      ) : (
        <List label="Templates">
          {templates.map((t) => (
            <ListRow
              key={t.id}
              href={`/dashboard/plans/${serviceTypeId}/${t.id}`}
              title={t.title}
              subtitle={`${t.itemCount} ${t.itemCount === 1 ? "item" : "items"} · ${formatDuration(t.totalSeconds)}`}
              status={t.id === defaultTemplateId ? <StatusBadge tone="ready">Default</StatusBadge> : undefined}
              trailing={
                <div className="flex flex-wrap gap-2">
                  {t.id !== defaultTemplateId && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => makeDefault(t.id, t.title)}>
                      <Star aria-hidden />
                      Make default
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" disabled={pending} onClick={() => remove(t.id, t.title)}>
                    Delete
                  </Button>
                </div>
              }
            />
          ))}
        </List>
      )}

      <form onSubmit={create} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="new-template-name">New template</Label>
          <Input
            id="new-template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Communion Sunday"
            maxLength={120}
          />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          <Plus aria-hidden />
          Add template
        </Button>
      </form>
    </div>
  );
}
