"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  highlightWords,
  joinHeadline,
  splitHeadline,
  type HeadlineParts,
} from "@/components/website-admin/headline-text";
import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SectionField } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";

/**
 * Renders a section's editable surface from its `fields` descriptor.
 *
 * There is deliberately no per-section-type form component. A master declares
 * what it exposes, this walks the declaration, and a new master therefore
 * arrives with a working editor already.
 */

type Value = unknown;
type Bag = Record<string, unknown>;

/** A section on this page that a link or button can jump to. */
export type LinkTarget = { value: string; label: string };

function get(bag: Bag, key: string): Value {
  return bag?.[key];
}

function asString(value: Value): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: Value): Bag {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Bag)
    : {};
}

function asArray(value: Value): Bag[] {
  return Array.isArray(value) ? (value as Bag[]) : [];
}

/** A blank item shaped by the list's own field descriptors. */
function emptyItem(fields: SectionField[]): Bag {
  const item: Bag = {};
  for (const field of fields) {
    if (field.type === "list") item[field.key] = [];
    else if (field.type === "group") item[field.key] = emptyItem(field.fields);
    else if (field.type === "toggle") item[field.key] = false;
    else if (field.type === "image") item[field.key] = { src: null, alt: "" };
    else if (field.type === "headline") item[field.key] = { lead: "" };
    else if (field.type === "paragraphs") item[field.key] = [];
    else item[field.key] = "";
  }
  return item;
}

function FieldShell({
  label,
  help,
  children,
  htmlFor,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </Label>
      {/* Below the control, so a field with help still lines up with one
       * without it when they share a row. */}
      {children}
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export function SectionFieldsForm({
  fields,
  value,
  onChange,
  idPrefix = "f",
  depth = 0,
  linkTargets = [],
}: {
  fields: SectionField[];
  value: Bag;
  onChange: (next: Bag) => void;
  idPrefix?: string;
  depth?: number;
  /** Sections a link can jump to; turns "Link" fields into a picker. */
  linkTargets?: LinkTarget[];
}) {
  const set = (key: string, next: Value) => onChange({ ...value, [key]: next });

  return (
    <div className={cn("flex flex-col gap-5", depth > 0 && "gap-4")}>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const current = get(value, field.key);

        switch (field.type) {
          case "url":
            // Links that can point at a section of this page get a picker of
            // sections; typing an address stays available under "More options".
            if (field.key === "href" && linkTargets.length > 0) {
              return (
                <LinkField
                  key={id}
                  id={id}
                  label={field.label}
                  help={field.help}
                  value={asString(current)}
                  targets={linkTargets}
                  onChange={(next) => set(field.key, next)}
                />
              );
            }
            return (
              <FieldShell key={id} label={field.label} help={field.help} htmlFor={id}>
                <Input
                  id={id}
                  value={asString(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              </FieldShell>
            );

          case "text":
            return (
              <FieldShell key={id} label={field.label} help={field.help} htmlFor={id}>
                <Input
                  id={id}
                  value={asString(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              </FieldShell>
            );

          case "textarea":
            return (
              <FieldShell key={id} label={field.label} help={field.help} htmlFor={id}>
                <Textarea
                  id={id}
                  rows={3}
                  value={asString(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              </FieldShell>
            );

          case "number":
            return (
              <FieldShell key={id} label={field.label} help={field.help} htmlFor={id}>
                <Input
                  id={id}
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={typeof current === "number" ? current : ""}
                  onChange={(e) =>
                    set(
                      field.key,
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </FieldShell>
            );

          case "toggle":
            return (
              <div key={id} className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={id} className="text-sm font-semibold">
                    {field.label}
                  </Label>
                  {field.help ? (
                    <p className="text-sm text-muted-foreground">{field.help}</p>
                  ) : null}
                </div>
                <Switch
                  id={id}
                  checked={current === true}
                  onCheckedChange={(checked) => set(field.key, checked)}
                />
              </div>
            );

          case "select":
            return (
              <FieldShell key={id} label={field.label} help={field.help} htmlFor={id}>
                <Select
                  id={id}
                  value={asString(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FieldShell>
            );

          /* lead / accent / trail. One plain box; the highlighted words (the
           * theme's serif italic) are an advanced option. */
          case "headline":
            return (
              <HeadlineField
                key={id}
                id={id}
                label={field.label}
                help={field.help}
                value={asRecord(current) as HeadlineParts}
                onChange={(next) => set(field.key, next)}
              />
            );

          case "image": {
            const img = asRecord(current);
            return (
              <div key={id} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <ImageUploadField
                  label={field.label}
                  help={field.help}
                  aspect={field.aspect}
                  value={asString(img.src)}
                  // Stored as null rather than "" so the renderer falls back to
                  // the striped placeholder instead of an empty <img>.
                  onChange={(url) => set(field.key, { ...img, src: url || null })}
                />
                <Input
                  placeholder="Describe the image for screen readers"
                  value={asString(img.alt)}
                  onChange={(e) => set(field.key, { ...img, alt: e.target.value })}
                />
                {!asString(img.src) ? (
                  <Input
                    placeholder="Placeholder caption shown until a photo is added"
                    value={asString(img.placeholder)}
                    onChange={(e) =>
                      set(field.key, { ...img, placeholder: e.target.value })
                    }
                  />
                ) : null}
              </div>
            );
          }

          case "paragraphs": {
            const paragraphs = Array.isArray(current)
              ? (current as unknown[]).map(asString)
              : [];
            return (
              <FieldShell key={id} label={field.label} help={field.help}>
                <div className="flex flex-col gap-2">
                  {paragraphs.map((paragraph, i) => (
                    <div key={i} className="flex gap-2">
                      <Textarea
                        rows={3}
                        value={paragraph}
                        onChange={(e) => {
                          const next = [...paragraphs];
                          next[i] = e.target.value;
                          set(field.key, next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="self-start"
                        aria-label={`Remove paragraph ${i + 1}`}
                        onClick={() =>
                          set(
                            field.key,
                            paragraphs.filter((_, index) => index !== i),
                          )
                        }
                      >
                        <Trash2 className="size-4" aria-hidden /> Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    onClick={() => set(field.key, [...paragraphs, ""])}
                  >
                    <Plus className="mr-1 size-4" /> Add paragraph
                  </Button>
                </div>
              </FieldShell>
            );
          }

          case "group":
            return (
              <FieldShell key={id} label={field.label} help={field.help}>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <SectionFieldsForm
                    fields={field.fields}
                    value={asRecord(current)}
                    onChange={(next) => set(field.key, next)}
                    idPrefix={id}
                    depth={depth + 1}
                    linkTargets={linkTargets}
                  />
                </div>
              </FieldShell>
            );

          case "list": {
            const items = asArray(current);
            return (
              <FieldShell key={id} label={field.label} help={field.help}>
                <div className="flex flex-col gap-3">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-muted/30 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[15px] font-semibold text-foreground">
                          {(field.titleKey && asString(item[field.titleKey])) ||
                            `${field.label} ${i + 1}`}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Remove ${
                            (field.titleKey && asString(item[field.titleKey])) ||
                            `${field.label} ${i + 1}`
                          }`}
                          onClick={() =>
                            set(
                              field.key,
                              items.filter((_, index) => index !== i),
                            )
                          }
                        >
                          <Trash2 className="size-4" aria-hidden /> Remove
                        </Button>
                      </div>
                      <SectionFieldsForm
                        fields={field.itemFields}
                        value={item}
                        onChange={(next) => {
                          const copy = [...items];
                          copy[i] = next;
                          set(field.key, copy);
                        }}
                        idPrefix={`${id}-${i}`}
                        depth={depth + 1}
                        linkTargets={linkTargets}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      set(field.key, [...items, emptyItem(field.itemFields)])
                    }
                  >
                    <Plus className="mr-1 size-4" /> {field.addLabel}
                  </Button>
                </div>
              </FieldShell>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * One "Headline" box. The three stored parts (lead / highlighted words /
 * trail) are rebuilt from what is typed, keeping the highlight on the same
 * words while they are still there. Choosing which words to highlight is an
 * advanced option.
 */
function HeadlineField({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: HeadlineParts;
  onChange: (next: HeadlineParts) => void;
}) {
  const joined = joinHeadline(value);
  // Local text, so typing a space at the end is not trimmed away mid-word.
  const [text, setText] = useState(joined);
  const accent = typeof value.accent === "string" ? value.accent : "";
  const [highlight, setHighlight] = useState(accent);
  const [missing, setMissing] = useState(false);

  // A reset (or undo) from outside replaces the value; follow it.
  useEffect(() => {
    if (joinHeadline(splitHeadline(text, value)) !== joined) setText(joined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only external changes
  }, [joined]);

  useEffect(() => {
    setHighlight(accent);
    setMissing(false);
  }, [accent]);

  return (
    <div className="flex flex-col gap-2">
      <FieldShell label={label} help={help} htmlFor={id}>
        <Input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(splitHeadline(e.target.value, value));
          }}
        />
      </FieldShell>
      <AdvancedSection
        title="Highlight some words"
        description="Show a few words of the headline in the special lettering."
      >
        <FieldShell
          label="Words to highlight"
          htmlFor={`${id}-highlight`}
          help={
            missing
              ? "Type whole words exactly as they appear in the headline above."
              : "Leave empty for no highlight."
          }
        >
          <Input
            id={`${id}-highlight`}
            value={highlight}
            aria-invalid={missing || undefined}
            onChange={(e) => {
              setHighlight(e.target.value);
              const next = highlightWords(value, e.target.value);
              if (next) {
                setMissing(false);
                onChange(next);
              } else {
                setMissing(true);
              }
            }}
          />
        </FieldShell>
      </AdvancedSection>
    </div>
  );
}

const CUSTOM_LINK = "__custom__";

/**
 * "Goes to": a picker of this page's sections, so nobody has to know that
 * "#about" means the About section. Any other address can still be typed,
 * under "More options".
 */
function LinkField({
  id,
  label,
  help,
  value,
  targets,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  targets: LinkTarget[];
  onChange: (next: string) => void;
}) {
  const matched = targets.find((target) => target.value === value);
  const [custom, setCustom] = useState(!matched && value.trim() !== "");

  // Follow a value replaced from outside (a reset, or undo).
  useEffect(() => {
    if (value.trim()) setCustom(!targets.some((target) => target.value === value));
  }, [value, targets]);

  const selectValue = custom ? CUSTOM_LINK : (matched?.value ?? "");

  return (
    <div className="flex flex-col gap-2">
      <FieldShell label={label} help={help} htmlFor={id}>
        <Select
          id={id}
          value={selectValue}
          onChange={(e) => {
            if (e.target.value === CUSTOM_LINK) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange(e.target.value);
          }}
        >
          <option value="">Choose a part of your page…</option>
          {targets.map((target) => (
            <option key={target.value} value={target.value}>
              {target.label}
            </option>
          ))}
          <option value={CUSTOM_LINK}>Another web address…</option>
        </Select>
      </FieldShell>
      <AdvancedSection
        title="Type the link yourself"
        description="For another website, a phone number, or an email address."
        forceOpen={custom}
      >
        <FieldShell
          label="Web address"
          htmlFor={`${id}-custom`}
          help="For example https://example.com, tel:5025550134 or mailto:office@church.org"
        >
          <Input
            id={`${id}-custom`}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              setCustom(!targets.some((target) => target.value === next));
              onChange(next);
            }}
          />
        </FieldShell>
      </AdvancedSection>
    </div>
  );
}
