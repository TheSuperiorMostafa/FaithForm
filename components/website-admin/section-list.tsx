"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  reorderSections,
  resetSection,
  saveSectionContent,
  setSectionVisible,
} from "@/app/dashboard/website/actions";
import { SaveStatus } from "@/components/website-admin/save-status";
import {
  SectionFieldsForm,
  type LinkTarget,
} from "@/components/website-admin/section-fields-form";
import { useAutosave } from "@/components/website-admin/use-autosave";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import type { SectionField } from "@/lib/sites/contract";
import { undoToast } from "@/lib/ui/undo-toast";
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
  isLive,
  initialOpenId = null,
  linkTargets = [],
  onSaved,
}: {
  sections: EditableSection[];
  canEdit: boolean;
  /** Whether edits reach visitors straight away, for honest confirm copy. */
  isLive: boolean;
  /** A section to open on arrival, e.g. the banner from "Change banner photo". */
  initialOpenId?: string | null;
  /** Sections a menu link or button can point to. */
  linkTargets?: LinkTarget[];
  /** Fired after any successful change, so a live preview can reload. */
  onSaved?: () => void;
}) {
  const [order, setOrder] = useState(sections);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
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
      toast.success(
        visible
          ? `${section.label} is showing on your website.`
          : `${section.label} is hidden from your website.`,
      );
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
          scrollOnMount={initialOpenId === section.id}
          onToggleOpen={() =>
            setOpenId(openId === section.id ? null : section.id)
          }
          onMove={move}
          onToggleVisible={toggleVisible}
          onSaved={onSaved}
          canEdit={canEdit}
          isLive={isLive}
          linkTargets={linkTargets}
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
  scrollOnMount,
  onToggleOpen,
  onMove,
  onToggleVisible,
  onSaved,
  canEdit,
  isLive,
  linkTargets,
  busy,
}: {
  section: EditableSection;
  index: number;
  total: number;
  open: boolean;
  scrollOnMount: boolean;
  onToggleOpen: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onToggleVisible: (section: EditableSection, visible: boolean) => void;
  onSaved?: () => void;
  canEdit: boolean;
  isLive: boolean;
  linkTargets: LinkTarget[];
  busy: boolean;
}) {
  const [draft, setDraft] = useState(section.content);
  const [saving, startSaving] = useTransition();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const locked = section.fields === null;
  const headline = siteHeadline(section.content);

  // Arriving from "Change banner photo": bring the opened editor into view.
  useEffect(() => {
    if (scrollOnMount) {
      rowRef.current?.scrollIntoView({ block: "start" });
    }
  }, [scrollOnMount]);

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

  async function reset() {
    const ok = await confirmAction({
      title: `Reset ${section.label} to how it started?`,
      description: isLive
        ? "Your changes to this section are removed, and your live website shows the original version straight away. You can undo this right after."
        : "Your changes to this section are removed. You can undo this right after.",
      confirmLabel: "Reset section",
      destructive: true,
    });
    if (!ok) return;

    // What the church had, so Undo can put it back exactly.
    const previous = draft;

    startSaving(async () => {
      const result = await resetSection(section.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Adopt what the server restored, so the fields show the default the
      // church just asked for instead of the edits it threw away. Without this
      // autosave would write the old edits straight back.
      setDraft(result.content);
      onSaved?.();

      undoToast(
        `${section.label} is back to how it started.`,
        async () => {
          const restored = await saveSectionContent({
            sectionId: section.id,
            content: previous,
          });
          if (!restored.ok) return restored.error;
          setDraft(previous);
          onSaved?.();
        },
        { undoneMessage: `Your changes to ${section.label} are back.` },
      );
    });
  }

  return (
    <div
      ref={rowRef}
      className={cn(
        "scroll-mt-6 rounded-2xl border border-border bg-card shadow-card",
        !section.isVisible && "bg-muted/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        {/* Room for a heading to read on one line: when the card is narrow the
         * buttons drop below it instead of squeezing it into a column. */}
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* The church's own heading leads, since that is what they are
             * looking for. The type name follows as the quieter subtitle. */}
            <span
              className={cn(
                "font-heading text-base font-bold sm:text-lg",
                !section.isVisible && "text-muted-foreground",
              )}
            >
              {headline ?? section.label}
            </span>
            {headline ? (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
                {section.label}
              </span>
            ) : null}
            {locked ? (
              <Lock className="size-4 text-muted-foreground" aria-hidden />
            ) : null}
            {section.hasOverride ? (
              <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-sm font-semibold text-accent">
                Edited
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {locked
              ? "FaithForm looks after this block. Contact support if you'd like it changed."
              : section.isVisible
                ? "Showing on your website"
                : "Hidden from your website"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move ${section.label} up`}
            disabled={index === 0 || busy || !canEdit}
            onClick={() => onMove(index, -1)}
          >
            <ArrowUp className="size-4" aria-hidden /> Move up
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move ${section.label} down`}
            disabled={index === total - 1 || busy || !canEdit}
            onClick={() => onMove(index, 1)}
          >
            <ArrowDown className="size-4" aria-hidden /> Move down
          </Button>
          <label className="flex min-h-11 items-center gap-2 px-2 text-[15px] font-medium">
            <Switch
              checked={section.isVisible}
              disabled={busy || !canEdit}
              onCheckedChange={(checked) => onToggleVisible(section, checked)}
              aria-label={`Show ${section.label} on your website`}
            />
            Show
          </label>
          {!locked ? (
            <Button
              type="button"
              variant={open ? "default" : "outline"}
              onClick={onToggleOpen}
              aria-expanded={open}
            >
              {open ? "Done" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>

      {open && section.fields ? (
        <div className="border-t border-border p-4 sm:p-6">
          <SectionFieldsForm
            fields={section.fields}
            value={draft}
            onChange={setDraft}
            idPrefix={section.id}
            linkTargets={linkTargets}
          />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <SaveStatus status={status} />
            <Button
              type="button"
              variant="ghost"
              onClick={() => void reset()}
              disabled={saving || !canEdit || !section.hasOverride}
            >
              <RotateCcw className="size-4" aria-hidden /> Reset to original
            </Button>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            {isLive
              ? "Changes save on their own and appear on your live website straight away."
              : "Changes save on their own. Visitors see them once you publish."}{" "}
            Anything you leave alone keeps following your church details.
          </p>
        </div>
      ) : null}
    </div>
  );
}
