"use client";

import { Plus, Trash2 } from "lucide-react";

import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {children}
    </div>
  );
}

export function SectionFieldsForm({
  fields,
  value,
  onChange,
  idPrefix = "f",
  depth = 0,
}: {
  fields: SectionField[];
  value: Bag;
  onChange: (next: Bag) => void;
  idPrefix?: string;
  depth?: number;
}) {
  const set = (key: string, next: Value) => onChange({ ...value, [key]: next });

  return (
    <div className={cn("flex flex-col gap-5", depth > 0 && "gap-4")}>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const current = get(value, field.key);

        switch (field.type) {
          case "text":
          case "url":
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
                    <p className="text-xs text-muted-foreground">{field.help}</p>
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
                <select
                  id={id}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  value={asString(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FieldShell>
            );

          /* lead / accent / trail. The accent renders in the theme's serif
           * italic, so it is a separate input rather than inline markup. */
          case "headline": {
            const h = asRecord(current);
            return (
              <FieldShell key={id} label={field.label} help={field.help}>
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                  <Input
                    placeholder="Headline"
                    value={asString(h.lead)}
                    onChange={(e) => set(field.key, { ...h, lead: e.target.value })}
                  />
                  <Input
                    placeholder="Emphasised words (optional)"
                    value={asString(h.accent)}
                    onChange={(e) => set(field.key, { ...h, accent: e.target.value })}
                  />
                  <Input
                    placeholder="Words after the emphasis (optional)"
                    value={asString(h.trail)}
                    onChange={(e) => set(field.key, { ...h, trail: e.target.value })}
                  />
                </div>
              </FieldShell>
            );
          }

          case "image": {
            const img = asRecord(current);
            return (
              <div key={id} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <ImageUploadField
                  label={field.label}
                  help={field.help}
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
                        size="icon"
                        aria-label={`Remove paragraph ${i + 1}`}
                        onClick={() =>
                          set(
                            field.key,
                            paragraphs.filter((_, index) => index !== i),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {(field.titleKey && asString(item[field.titleKey])) ||
                            `${field.label} ${i + 1}`}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${field.label} ${i + 1}`}
                          onClick={() =>
                            set(
                              field.key,
                              items.filter((_, index) => index !== i),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
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
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
