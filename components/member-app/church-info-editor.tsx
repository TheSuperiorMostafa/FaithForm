"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Clock,
  Image as ImageIcon,
  Link2,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { saveChurchAppInfo, uploadChurchAppImage } from "@/app/dashboard/app/actions";
import { ChurchAppPreview, SOCIAL_STYLE } from "@/components/member-app/church-app-preview";
import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_QUICK_LINKS,
  MAX_QUICK_LINK_LABEL,
  SOCIAL_PLATFORMS,
  normalizeSocialUrl,
  normalizeWebUrl,
  type SocialPlatformKey,
} from "@/lib/faithform/church-links";
import type { ChurchAppInfo, ChurchAppInfoContext } from "@/lib/queries/church-app-info";
import { cn } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const LINK_SUGGESTIONS = [
  "Plan a visit",
  "Prayer request",
  "Small groups",
  "Serve",
  "Kids ministry",
  "Events",
];

const SECTIONS = [
  { id: "identity", label: "Look & name", icon: ImageIcon },
  { id: "about", label: "About", icon: Type },
  { id: "services", label: "Service times", icon: Clock },
  { id: "contact", label: "Location & contact", icon: MapPin },
  { id: "social", label: "Social", icon: Users },
  { id: "links", label: "Links", icon: Link2 },
] as const;

let idCounter = 0;
const newId = () => `new-${Date.now().toString(36)}-${(idCounter += 1)}`;

/**
 * The church's page in the member app, edited in one place with a live phone
 * beside it.
 *
 * Organized the way a church thinks about itself — how it looks, who it is,
 * when it meets, where to find it, where else to follow along, and what it
 * wants people to do — rather than the way the columns are stored.
 */
export function ChurchInfoEditor({
  initial,
  context,
  canEdit,
}: {
  initial: ChurchAppInfo;
  context: ChurchAppInfoContext;
  canEdit: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const disabled = !canEdit || pending;

  const set = <K extends keyof ChurchAppInfo>(key: K, value: ChurchAppInfo[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldError(null);
  };

  const save = useCallback(() => {
    if (!canEdit || pending) return;
    startTransition(async () => {
      const result = await saveChurchAppInfo(form);
      if (result.ok) {
        setSaved(result.info);
        setForm(result.info);
        setFieldError(null);
        toast.success("Your church page is updated in the app.");
      } else {
        setFieldError({ field: result.field, message: result.error });
        toast.error(result.error);
        if (result.field) {
          const target = formRef.current?.querySelector<HTMLElement>(
            `[data-field="${CSS.escape(result.field)}"]`,
          );
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.focus();
        }
      }
    });
  }, [canEdit, pending, form]);

  // ⌘S / Ctrl+S saves, like every other editor people already use.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  const completeness = useMemo(() => {
    const checks = [
      Boolean(form.coverImageUrl),
      Boolean(form.logoUrl),
      Boolean(form.tagline.trim()),
      Boolean(form.about.trim()),
      form.serviceTimes.some((row) => row.label.trim()),
      Boolean(form.address.trim() || form.mapsUrl.trim()),
      Boolean(form.phone.trim() || form.email.trim()),
      SOCIAL_PLATFORMS.some((platform) => form.social[platform.key]?.trim()),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form]);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex min-w-0 flex-col gap-5"
      >
        {/* Section jump bar + completeness */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#church-${section.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
            >
              <section.icon className="size-3.5" aria-hidden />
              {section.label}
            </a>
          ))}
          <div className="ml-auto flex items-center gap-2 px-2" title="How complete your church page is">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${completeness}%` }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {completeness}%
            </span>
          </div>
        </div>

        {!canEdit && (
          <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Only church admins can change the church page. You can still preview it here.
          </p>
        )}

        <Section id="identity" icon={ImageIcon} title="Look & name" description="The first thing people see when they open your church.">
          <ImageUploadField
            label="Cover photo"
            value={form.coverImageUrl}
            onChange={(url) => set("coverImageUrl", url)}
            aspect="video"
            previewClassName="max-w-md"
            help="A wide photo of your building, your people, or worship. It fills the top of your page."
            disabled={disabled}
            uploadAction={uploadChurchAppImage}
          />
          <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
            <ImageUploadField
              label="Logo"
              value={form.logoUrl}
              onChange={(url) => set("logoUrl", url)}
              help="Square works best."
              disabled={disabled}
              uploadAction={uploadChurchAppImage}
            />
            <div className="flex flex-col gap-4">
              <Field label="Church name" field="name" error={errorFor("name")}>
                <Input
                  data-field="name"
                  value={form.name}
                  maxLength={200}
                  disabled={disabled}
                  onChange={(event) => set("name", event.target.value)}
                />
              </Field>
              <Field
                label="Tagline"
                field="tagline"
                hint="One short line under your name."
                counter={`${form.tagline.length}/120`}
              >
                <Input
                  data-field="tagline"
                  value={form.tagline}
                  maxLength={120}
                  disabled={disabled}
                  placeholder="A church for the whole city"
                  onChange={(event) => set("tagline", event.target.value)}
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section id="about" icon={Type} title="About" description="Who you are and what a first visit is like. Long text folds behind “Read more”.">
          <Field label="About your church" field="about" counter={`${form.about.length}/2000`} error={errorFor("about")}>
            <Textarea
              data-field="about"
              value={form.about}
              rows={6}
              maxLength={2000}
              disabled={disabled}
              placeholder="We're a family of believers in the heart of town. Sundays are relaxed — come as you are, coffee's on, and there's a great program for kids."
              onChange={(event) => set("about", event.target.value)}
            />
          </Field>
        </Section>

        <Section
          id="services"
          icon={Clock}
          title="Service times"
          description="Shown as “Next service” with a countdown, then the full list. Times are your church's local time."
        >
          <div className="flex flex-col gap-2">
            {form.serviceTimes.length === 0 && (
              <EmptyHint>No service times yet. Add your main gathering first.</EmptyHint>
            )}
            {form.serviceTimes.map((row, index) => (
              <div
                key={row.clientId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-background p-2 sm:grid-cols-[minmax(0,1fr)_150px_130px_auto]"
              >
                <Input
                  aria-label="Service name"
                  data-field={`serviceTimes.${index}.label`}
                  value={row.label}
                  maxLength={120}
                  disabled={disabled}
                  placeholder="Sunday Worship"
                  className="col-span-2 sm:col-span-1"
                  onChange={(event) =>
                    set(
                      "serviceTimes",
                      form.serviceTimes.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)),
                    )
                  }
                />
                <Select
                  aria-label="Day"
                  value={row.dayOfWeek}
                  disabled={disabled}
                  onChange={(event) =>
                    set(
                      "serviceTimes",
                      form.serviceTimes.map((r, i) =>
                        i === index ? { ...r, dayOfWeek: Number(event.target.value) } : r,
                      ),
                    )
                  }
                >
                  {DAYS.map((day, value) => (
                    <option key={day} value={value}>
                      {day}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Start time"
                  type="time"
                  data-field={`serviceTimes.${index}.startTime`}
                  value={row.startTime}
                  disabled={disabled}
                  onChange={(event) =>
                    set(
                      "serviceTimes",
                      form.serviceTimes.map((r, i) =>
                        i === index ? { ...r, startTime: event.target.value } : r,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${row.label || "service"}`}
                  disabled={disabled}
                  onClick={() => set("serviceTimes", form.serviceTimes.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || form.serviceTimes.length >= 20}
                onClick={() =>
                  set("serviceTimes", [
                    ...form.serviceTimes,
                    { clientId: newId(), label: "", dayOfWeek: 0, startTime: "10:00" },
                  ])
                }
              >
                <Plus aria-hidden /> Add a service
              </Button>
              {form.serviceTimes.length === 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    set("serviceTimes", [
                      { clientId: newId(), label: "Sunday Worship", dayOfWeek: 0, startTime: "10:00" },
                    ])
                  }
                >
                  <Sparkles aria-hidden /> Sunday at 10:00
                </Button>
              )}
            </div>
          </div>
        </Section>

        <Section
          id="contact"
          icon={MapPin}
          title="Location & contact"
          description="Powers the Directions, Call, Email and Website buttons at the top of your page."
        >
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Street address" field="address" className="sm:col-span-6">
              <Input data-field="address" value={form.address} disabled={disabled} maxLength={200} placeholder="123 Main Street"
                onChange={(event) => set("address", event.target.value)} />
            </Field>
            <Field label="City" field="city" className="sm:col-span-3">
              <Input data-field="city" value={form.city} disabled={disabled} maxLength={120}
                onChange={(event) => set("city", event.target.value)} />
            </Field>
            <Field label="State" field="state" className="sm:col-span-1">
              <Input data-field="state" value={form.state} disabled={disabled} maxLength={60}
                onChange={(event) => set("state", event.target.value)} />
            </Field>
            <Field label="ZIP" field="zip" className="sm:col-span-2">
              <Input data-field="zip" value={form.zip} disabled={disabled} maxLength={20} inputMode="numeric"
                onChange={(event) => set("zip", event.target.value)} />
            </Field>
            <Field label="Phone" field="phone" className="sm:col-span-3">
              <Input data-field="phone" type="tel" value={form.phone} disabled={disabled} maxLength={40} placeholder="(555) 123-4567"
                onChange={(event) => set("phone", event.target.value)} />
            </Field>
            <Field label="Email" field="email" className="sm:col-span-3" error={errorFor("email")}>
              <Input data-field="email" type="email" value={form.email} disabled={disabled} maxLength={200} placeholder="hello@yourchurch.org"
                onChange={(event) => set("email", event.target.value)} />
            </Field>
            <Field
              label="Website"
              field="website"
              className="sm:col-span-3"
              error={errorFor("website") ?? linkProblem(form.website)}
            >
              <Input data-field="website" value={form.website} disabled={disabled} maxLength={500} placeholder="yourchurch.org"
                onChange={(event) => set("website", event.target.value)} />
            </Field>
            <Field
              label="Maps link"
              field="mapsUrl"
              className="sm:col-span-3"
              hint="Optional. Leave blank and we'll use your address."
              error={errorFor("mapsUrl") ?? linkProblem(form.mapsUrl)}
            >
              <Input data-field="mapsUrl" value={form.mapsUrl} disabled={disabled} maxLength={500} placeholder="Paste from Google or Apple Maps"
                onChange={(event) => set("mapsUrl", event.target.value)} />
            </Field>
          </div>
        </Section>

        <Section
          id="social"
          icon={Users}
          title="Social"
          description="Paste a link or just your @handle — we'll turn it into the right link. Empty ones are hidden."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((platform) => (
              <SocialField
                key={platform.key}
                platform={platform.key}
                label={platform.label}
                placeholder={platform.placeholder}
                value={form.social[platform.key] ?? ""}
                disabled={disabled}
                serverError={errorFor(`social.${platform.key}`)}
                onChange={(value) => set("social", { ...form.social, [platform.key]: value })}
              />
            ))}
          </div>
        </Section>

        <Section
          id="links"
          icon={Link2}
          title="Links"
          description="Point people to what you want them to do next. Shown in this order."
          aside={
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {form.quickLinks.length}/{MAX_QUICK_LINKS}
            </span>
          }
        >
          {!context.quickLinksAvailable && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              Links need a quick database update (migration 0090) before they can be saved.
              Everything else on this page works now.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {form.quickLinks.length === 0 && (
              <EmptyHint>No links yet. Try one of the suggestions below.</EmptyHint>
            )}
            {form.quickLinks.map((link, index) => (
              <div
                key={link.clientId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl border border-border bg-background p-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]"
              >
                <Input
                  aria-label="Link name"
                  data-field={`quickLinks.${index}.label`}
                  value={link.label}
                  maxLength={MAX_QUICK_LINK_LABEL}
                  disabled={disabled}
                  placeholder="Plan a visit"
                  className="col-span-2 sm:col-span-1"
                  onChange={(event) =>
                    set(
                      "quickLinks",
                      form.quickLinks.map((l, i) => (i === index ? { ...l, label: event.target.value } : l)),
                    )
                  }
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <Input
                    aria-label="Link address"
                    data-field={`quickLinks.${index}.url`}
                    value={link.url}
                    maxLength={500}
                    disabled={disabled}
                    placeholder="yourchurch.org/visit"
                    aria-invalid={Boolean(linkProblem(link.url)) || undefined}
                    onChange={(event) =>
                      set(
                        "quickLinks",
                        form.quickLinks.map((l, i) => (i === index ? { ...l, url: event.target.value } : l)),
                      )
                    }
                  />
                  {(errorFor(`quickLinks.${index}.url`) ?? linkProblem(link.url)) && (
                    <span className="text-[11px] font-medium text-destructive">
                      {errorFor(`quickLinks.${index}.url`) ?? linkProblem(link.url)}
                    </span>
                  )}
                </div>
                <div className="flex items-center">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up"
                    disabled={disabled || index === 0}
                    onClick={() => set("quickLinks", move(form.quickLinks, index, index - 1))}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down"
                    disabled={disabled || index === form.quickLinks.length - 1}
                    onClick={() => set("quickLinks", move(form.quickLinks, index, index + 1))}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${link.label || "link"}`}
                    disabled={disabled}
                    onClick={() => set("quickLinks", form.quickLinks.filter((_, i) => i !== index))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || form.quickLinks.length >= MAX_QUICK_LINKS}
                onClick={() =>
                  set("quickLinks", [...form.quickLinks, { clientId: newId(), label: "", url: "" }])
                }
              >
                <Plus aria-hidden /> Add a link
              </Button>
              {LINK_SUGGESTIONS.filter(
                (suggestion) => !form.quickLinks.some((link) => link.label.trim() === suggestion),
              ).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={disabled || form.quickLinks.length >= MAX_QUICK_LINKS}
                  onClick={() =>
                    set("quickLinks", [
                      ...form.quickLinks,
                      { clientId: newId(), label: suggestion, url: "" },
                    ])
                  }
                  className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:opacity-40"
                >
                  + {suggestion}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Sticky save bar */}
        {canEdit && (
          <div
            className={cn(
              "sticky bottom-4 z-20 transition-all duration-300",
              dirty || pending ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
            )}
            aria-hidden={!dirty && !pending}
          >
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/95 p-3 pl-5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur">
              <span className="size-2 rounded-full bg-accent" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Unsaved changes</p>
              <p className="hidden text-xs text-muted-foreground sm:block">⌘S to save</p>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={pending}
                  onClick={() => {
                    setForm(saved);
                    setFieldError(null);
                  }}>
                  Discard
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Saving…" : "Save & publish"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </form>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="mb-3 flex items-center justify-between xl:justify-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live preview
          </p>
        </div>
        <ChurchAppPreview info={form} context={context} />
        <p className="mx-auto mt-3 max-w-[320px] text-center text-xs text-muted-foreground">
          Updates as you type. People see changes the next time they open your page.
        </p>
      </aside>
    </div>
  );
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function linkProblem(value: string): string | undefined {
  if (!value.trim()) return undefined;
  return normalizeWebUrl(value) ? undefined : "That doesn't look like a web address.";
}

function Section({
  id,
  icon: Icon,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={`church-${id}`} className="scroll-mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-base font-bold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {aside}
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  field,
  hint,
  counter,
  error,
  className,
  children,
}: {
  label: string;
  field: string;
  hint?: string;
  counter?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-field-wrapper={field}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm font-semibold">{label}</Label>
        {counter && <span className="text-[11px] tabular-nums text-muted-foreground">{counter}</span>}
      </div>
      {children}
      {error ? (
        <span className="text-xs font-medium text-destructive">{error}</span>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

function SocialField({
  platform,
  label,
  placeholder,
  value,
  disabled,
  serverError,
  onChange,
}: {
  platform: SocialPlatformKey;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  serverError?: string;
  onChange: (value: string) => void;
}) {
  const style = SOCIAL_STYLE[platform];
  const normalized = value.trim() ? normalizeSocialUrl(platform, value) : null;
  const problem =
    serverError ??
    (value.trim() && !normalized
      ? platform === "podcast"
        ? "Paste the full link to your podcast."
        : "Paste a link or @handle."
      : undefined);

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
        style={{ background: style.color }}
      >
        <style.icon className="size-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label htmlFor={`social-${platform}`} className="text-xs font-semibold">
          {label}
        </Label>
        <Input
          id={`social-${platform}`}
          data-field={`social.${platform}`}
          value={value}
          maxLength={500}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={Boolean(problem) || undefined}
          className="min-h-9 py-1.5 text-sm"
          onChange={(event) => onChange(event.target.value)}
        />
        {problem ? (
          <span className="text-[11px] font-medium text-destructive">{problem}</span>
        ) : normalized ? (
          <a
            href={normalized}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            ✓ {normalized.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}
