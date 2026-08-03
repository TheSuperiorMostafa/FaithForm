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
import { SaveStatus } from "@/components/website-admin/save-status";
import { SectionFieldsForm } from "@/components/website-admin/section-fields-form";
import { useAutosave } from "@/components/website-admin/use-autosave";
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

/**
 * The heading this section actually shows on the church's website.
 *
 * The list is otherwise labelled by section *type* — "About", "Vision &
 * mission" — which is not what the church reads on its own page. Someone whose
 * about section is headed "Who we are" had no way to tell which block was
 * theirs, and concluded the fields they wanted did not exist.
 */
function siteHeadline(content: Record<string, unknown>): string | null {
  const headline = content.headline;
  if (typeof headline === "string") return headline.trim() || null;

  if (headline && typeof headline === "object") {
    const parts = headline as Record<string, unknown>;
    const text = [parts.lead, parts.accent, parts.trail]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  }

  return null;
}

export function SectionList({
  sections,
  canEdit,
  onSaved,
}: {
  sections: EditableSection[];
  canEdit: boolean;
  /** Fired after any successful change, so a live preview can reload. */
  onSaved?: () => void;
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
        return;
      }
      onSaved?.();
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
        return;
      }
      onSaved?.();
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
          onSaved={onSaved}
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
  onSaved,
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
  onSaved?: () => void;
  canEdit: boolean;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(section.content);
  const [saving, startSaving] = useTransition();
  const locked = section.fields === null;
  const headline = siteHeadline(section.content);

  // Only autosave while the editor is actually open. A closed section keeps its
  // draft in state, and saving it in the background would write content the
  // church is not looking at.
  const { status } = useAutosave(
    draft,
    async (content) => {
      const result = await saveSectionContent({ sectionId: section.id, content });
      if (result.ok) onSaved?.();
      return result;
    },
    { enabled: open && canEdit && !locked },
  );

  function reset() {
    startSaving(async () => {
      const result = await resetSection(section.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Adopt what the server restored, so the fields show the default the
      // church just asked for instead of the edits it threw away.
      setDraft(result.content);
      toast.success(`${section.label} reset to its default content.`);
      onSaved?.();
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* The church's own heading leads, since that is what they are
             * looking for. The type name follows as the quieter subtitle. */}
            <span className="font-heading text-base font-bold">
              {headline ?? section.label}
            </span>
            {headline ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </span>
            ) : null}
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

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <SaveStatus status={status} />
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
            Changes save on their own. Only what you actually change is stored,
            so anything left alone keeps following your Church Profile.
          </p>
        </div>
      ) : null}
    </div>
  );
}
