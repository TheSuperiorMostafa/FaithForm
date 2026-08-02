"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  reorderSections,
  resetSection,
  saveSectionContent,
  setSectionVisible,
} from "@/app/dashboard/website/actions";
import { SectionFieldsForm } from "@/components/website-admin/section-fields-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { SectionField } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";

export type EditableSection = {
  id: string;
  type: string;
  label: string;
  isVisible: boolean;
  hasOverride: boolean;
  /** Fully resolved content — what a visitor currently sees. */
  content: Record<string, unknown>;
  /** Null when the section is not church-editable (the escape hatch). */
  fields: SectionField[] | null;
};

export function SectionList({
  sections,
  canEdit,
}: {
  sections: EditableSection[];
  canEdit: boolean;
}) {
  const [order, setOrder] = useState(sections);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;

    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);

    startTransition(async () => {
      const result = await reorderSections(next.map((s) => s.id));
      if (!result.ok) {
        setOrder(order);
        toast.error(result.error);
      }
    });
  }

  function toggleVisible(section: EditableSection, visible: boolean) {
    setOrder((current) =>
      current.map((s) => (s.id === section.id ? { ...s, isVisible: visible } : s)),
    );

    startTransition(async () => {
      const result = await setSectionVisible(section.id, visible);
      if (!result.ok) {
        setOrder((current) =>
          current.map((s) =>
            s.id === section.id ? { ...s, isVisible: !visible } : s,
          ),
        );
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {order.map((section, index) => (
        <SectionRow
          key={section.id}
          section={section}
          index={index}
          total={order.length}
          open={openId === section.id}
          onToggleOpen={() =>
            setOpenId(openId === section.id ? null : section.id)
          }
          onMove={move}
          onToggleVisible={toggleVisible}
          canEdit={canEdit}
          busy={pending}
        />
      ))}
    </div>
  );
}

function SectionRow({
  section,
  index,
  total,
  open,
  onToggleOpen,
  onMove,
  onToggleVisible,
  canEdit,
  busy,
}: {
  section: EditableSection;
  index: number;
  total: number;
  open: boolean;
  onToggleOpen: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onToggleVisible: (section: EditableSection, visible: boolean) => void;
  canEdit: boolean;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(section.content);
  const [saving, startSaving] = useTransition();
  const locked = section.fields === null;

  function save() {
    startSaving(async () => {
      const result = await saveSectionContent({
        sectionId: section.id,
        content: draft,
      });
      result.ok
        ? toast.success(`${section.label} saved.`)
        : toast.error(result.error);
    });
  }

  function reset() {
    startSaving(async () => {
      const result = await resetSection(section.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${section.label} reset to its default content.`);
    });
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card shadow-card",
        !section.isVisible && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Move ${section.label} up`}
            disabled={index === 0 || busy || !canEdit}
            onClick={() => onMove(index, -1)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Move ${section.label} down`}
            disabled={index === total - 1 || busy || !canEdit}
            onClick={() => onMove(index, 1)}
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-heading text-base font-bold">
              {section.label}
            </span>
            {locked ? (
              <Lock className="size-3.5 text-muted-foreground" aria-hidden />
            ) : null}
            {section.hasOverride ? (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Edited
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {locked
              ? "Managed by FaithForm — contact support to change this block."
              : section.isVisible
                ? "Showing on your website"
                : "Hidden from your website"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={section.isVisible}
            disabled={busy || !canEdit}
            onCheckedChange={(checked) => onToggleVisible(section, checked)}
            aria-label={`Show ${section.label}`}
          />
          {!locked ? (
            <Button type="button" variant="outline" size="sm" onClick={onToggleOpen}>
              {open ? "Close" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>

      {open && section.fields ? (
        <div className="border-t border-border p-4">
          <SectionFieldsForm
            fields={section.fields}
            value={draft}
            onChange={setDraft}
            idPrefix={section.id}
          />

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={save} disabled={saving || !canEdit}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={saving || !canEdit || !section.hasOverride}
            >
              <RotateCcw className="mr-1 size-4" /> Reset to default
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Only what you actually change is saved, so anything left alone keeps
            following your Church Profile.
          </p>
        </div>
      ) : null}
    </div>
  );
}
