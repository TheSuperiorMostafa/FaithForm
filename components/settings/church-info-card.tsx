"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Area } from "react-easy-crop";
import { Clock, ImageIcon, MapPin, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { updateChurchBranding } from "@/app/dashboard/settings/branding-actions";
import { saveChurchBasics } from "@/app/dashboard/settings/church-info-actions";
import type { ChurchBasics } from "@/components/settings/church-basics";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { downscaleForUpload } from "@/lib/sites/downscale-image";
import { cn } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let rowCounter = 0;
const newRowId = () => `new-${Date.now().toString(36)}-${(rowCounter += 1)}`;

/** "10:30" → "10:30 AM", for the read-only view. */
function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "America/Chicago" → "Central Time (Chicago)" where the browser knows it. */
function describeTimeZone(zone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    const city = zone.split("/").pop()?.replace(/_/g, " ");
    return name ? `${name}${city ? ` (${city})` : ""}` : zone;
  } catch {
    return zone;
  }
}

// ---------------------------------------------------------------------------
// Logo and cover photo
// ---------------------------------------------------------------------------

type ImageKind = "logo" | "cover";

const IMAGE_COPY: Record<ImageKind, { label: string; hint: string; ratio: number }> = {
  logo: { label: "Logo", hint: "A square image. It shows on your app page and website.", ratio: 1 },
  cover: {
    label: "Cover photo",
    hint: "A wide photo of your building or people. It fills the top of your app page.",
    ratio: 16 / 9,
  },
};

function ChurchImageField({
  kind,
  url,
  canEdit,
}: {
  kind: ImageKind;
  url: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = IMAGE_COPY[kind];
  const inputId = `church-${kind}-file`;

  async function save(file: File | null, crop?: Area) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (file) form.set("photo", file);
      else form.set("remove", "true");
      if (crop) form.set("crop", JSON.stringify(crop));
      const result = await updateChurchBranding(kind, form);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      toast.success(
        file
          ? `${copy.label} updated. It now shows in the app and on your website.`
          : `${copy.label} removed.`,
      );
      router.refresh();
    } catch {
      setError(`We couldn't save your ${copy.label.toLowerCase()}. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Remove your ${copy.label.toLowerCase()}?`,
      description: `It disappears from the app and your website. You can add a new one at any time.`,
      confirmLabel: `Remove ${copy.label.toLowerCase()}`,
      destructive: true,
    });
    if (ok) await save(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-semibold text-foreground">{copy.label}</p>
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/40",
          kind === "logo" ? "size-32" : "aspect-video w-full max-w-md",
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={kind === "logo" ? "Church logo" : "Church cover photo"}
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon className="size-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        )}
      </div>
      <p className="text-sm text-muted-foreground">{copy.hint}</p>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                if (file.size > 12 * 1024 * 1024) throw new Error("too big");
                const prepared = await downscaleForUpload(file);
                if (prepared.size > 3_400_000) throw new Error("too big");
                setDraft(prepared);
              } catch {
                setError("Choose a JPG, PNG or WebP photo under 12 MB.");
              } finally {
                setBusy(false);
              }
            }}
          />
          <label
            htmlFor={inputId}
            className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer", busy && "pointer-events-none opacity-50")}
          >
            <Upload aria-hidden />
            {busy ? "Saving…" : url ? `Change ${copy.label.toLowerCase()}` : `Add a ${copy.label.toLowerCase()}`}
          </label>
          {url && (
            <Button type="button" variant="ghost" disabled={busy} onClick={remove}>
              <Trash2 aria-hidden />
              Remove
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {draft && (
        <ImageCropper
          file={draft}
          shape={{ label: copy.label, hint: "Drag and zoom to choose what shows", ratio: copy.ratio }}
          onCancel={() => setDraft(null)}
          onConfirm={(crop) => {
            const selected = draft;
            setDraft(null);
            void save(selected, crop);
          }}
        />
      )}
    </div>
  );
}

export function ChurchImagesCard({
  logoUrl,
  coverUrl,
  canEdit,
}: {
  logoUrl: string | null;
  coverUrl: string | null;
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo and cover photo</CardTitle>
        <CardDescription className="text-[15px]">
          How your church looks in the app and on your website.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 sm:grid-cols-[auto_minmax(0,1fr)]">
          <ChurchImageField kind="logo" url={logoUrl} canEdit={canEdit} />
          <ChurchImageField kind="cover" url={coverUrl} canEdit={canEdit} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id} className="text-[15px]">
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ChurchDetailsForm({
  initial,
  timezone,
  canEdit,
  appPageHref,
}: {
  initial: ChurchBasics;
  timezone: string;
  canEdit: boolean;
  /** Where the rest of the church page is edited, when this person can open it. */
  appPageHref: string | null;
}) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const router = useRouter();

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const set = <K extends keyof ChurchBasics>(key: K, value: ChurchBasics[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldError(null);
  };

  const errorFor = (field: string) =>
    fieldError?.field === field || fieldError?.field?.startsWith(`${field}.`)
      ? fieldError.message
      : undefined;

  const save = () => {
    if (!canEdit || pending) return;
    startTransition(async () => {
      try {
        const result = await saveChurchBasics(form);
        if (result.ok) {
          setSaved(result.basics);
          setForm(result.basics);
          setFieldError(null);
          toast.success("Church details saved. The app and your website now show them.");
          router.refresh();
          return;
        }
        setFieldError({ field: result.field, message: result.error });
        toast.error(result.error);
      } catch {
        const message = "We couldn't save your church details. Please try again.";
        setFieldError({ message });
        toast.error(message);
      }
    });
  };

  if (!canEdit) {
    return <ChurchDetailsReadOnly basics={initial} timezone={timezone} />;
  }

  const updateService = (index: number, patch: Partial<ChurchBasics["serviceTimes"][number]>) =>
    set(
      "serviceTimes",
      form.serviceTimes.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>Church details</CardTitle>
          <CardDescription className="text-[15px]">
            Entered once and used everywhere: your app page, your website and the phone assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field id="church_name" label="Church name" error={errorFor("name")}>
            <Input
              id="church_name"
              value={form.name}
              maxLength={200}
              required
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="church_phone" label="Phone" error={errorFor("phone")}>
              <Input
                id="church_phone"
                type="tel"
                autoComplete="tel"
                value={form.phone}
                maxLength={40}
                placeholder="(555) 123-4567"
                onChange={(event) => set("phone", event.target.value)}
              />
            </Field>
            <Field id="church_email" label="Email" error={errorFor("email")}>
              <Input
                id="church_email"
                type="email"
                value={form.email}
                maxLength={200}
                placeholder="office@yourchurch.org"
                onChange={(event) => set("email", event.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
            Address
          </CardTitle>
          <CardDescription className="text-[15px]">
            Where people come on Sunday. It&apos;s shown with a map link in the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field id="church_address" label="Street address" error={errorFor("address")}>
            <Input
              id="church_address"
              autoComplete="street-address"
              value={form.address}
              maxLength={200}
              placeholder="123 Main Street"
              onChange={(event) => set("address", event.target.value)}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field id="church_city" label="City" error={errorFor("city")}>
              <Input
                id="church_city"
                autoComplete="address-level2"
                value={form.city}
                maxLength={120}
                onChange={(event) => set("city", event.target.value)}
              />
            </Field>
            <Field id="church_state" label="State" error={errorFor("state")}>
              <Input
                id="church_state"
                autoComplete="address-level1"
                value={form.state}
                maxLength={60}
                onChange={(event) => set("state", event.target.value)}
              />
            </Field>
            <Field id="church_zip" label="ZIP code" error={errorFor("zip")}>
              <Input
                id="church_zip"
                autoComplete="postal-code"
                value={form.zip}
                maxLength={20}
                onChange={(event) => set("zip", event.target.value)}
              />
            </Field>
          </div>
          <div className="rounded-2xl bg-muted/50 px-5 py-4">
            <p className="text-[15px] font-semibold text-foreground">Time zone</p>
            <p className="text-[15px] text-foreground/80">{describeTimeZone(timezone)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Service times and reminders use this. If it&apos;s wrong,{" "}
              <Link
                href="/dashboard/support?from=/dashboard/settings"
                className="font-semibold text-primary underline underline-offset-4 dark:text-accent"
              >
                send us a message
              </Link>{" "}
              and we&apos;ll change it for you.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
            Service times
          </CardTitle>
          <CardDescription className="text-[15px]">
            Shown in the app as &ldquo;Next service&rdquo;. Attendance uses them to set up each
            Sunday.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {form.serviceTimes.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border px-5 py-4 text-[15px] text-muted-foreground">
              No service times yet. Add your main service first.
            </p>
          )}
          {form.serviceTimes.map((row, index) => (
            <div
              key={row.clientId}
              className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[minmax(0,1fr)_170px_140px_auto] sm:items-end"
            >
              <Field id={`service_${index}_label`} label="Name" error={errorFor(`serviceTimes.${index}.label`)}>
                <Input
                  id={`service_${index}_label`}
                  value={row.label}
                  maxLength={120}
                  placeholder="Sunday Worship"
                  onChange={(event) => updateService(index, { label: event.target.value })}
                />
              </Field>
              <Field id={`service_${index}_day`} label="Day">
                <Select
                  id={`service_${index}_day`}
                  value={row.dayOfWeek}
                  onChange={(event) => updateService(index, { dayOfWeek: Number(event.target.value) })}
                >
                  {DAYS.map((day, value) => (
                    <option key={day} value={value}>
                      {day}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id={`service_${index}_time`}
                label="Starts at"
                error={errorFor(`serviceTimes.${index}.startTime`)}
              >
                <Input
                  id={`service_${index}_time`}
                  type="time"
                  value={row.startTime}
                  required
                  onChange={(event) => updateService(index, { startTime: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove ${row.label || "this service"}`}
                onClick={() => set("serviceTimes", form.serviceTimes.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              set("serviceTimes", [
                ...form.serviceTimes,
                { clientId: newRowId(), label: "", dayOfWeek: 0, startTime: "10:00" },
              ])
            }
          >
            <Plus aria-hidden />
            Add a service time
          </Button>
          <p className="text-sm text-muted-foreground">
            A service with no name isn&apos;t saved.
          </p>
        </CardContent>
      </Card>

      {appPageHref && (
        <p className="text-[15px] text-muted-foreground">
          Your tagline, the &ldquo;About&rdquo; text and social links are on the{" "}
          <Link
            href={appPageHref}
            className="font-semibold text-primary underline underline-offset-4 dark:text-accent"
          >
            App page
          </Link>
          .
        </p>
      )}

      {fieldError && !fieldError.field && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {fieldError.message}
        </p>
      )}

      {/* Visible only while there is something to save, and always in reach. */}
      {dirty && (
        <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-accent/50 bg-card p-4 shadow-card-hover sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] font-semibold text-foreground">You have changes that aren&apos;t saved.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setForm(saved);
                setFieldError(null);
              }}
            >
              Undo my changes
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Saving…" : "Save church details"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function ChurchDetailsReadOnly({ basics, timezone }: { basics: ChurchBasics; timezone: string }) {
  const address = [basics.address, [basics.city, basics.state].filter(Boolean).join(", "), basics.zip]
    .filter((part) => part && part.trim())
    .join(" ");
  const rows: Array<{ label: string; value: string }> = [
    { label: "Church name", value: basics.name },
    { label: "Phone", value: basics.phone },
    { label: "Email", value: basics.email },
    { label: "Address", value: address },
    { label: "Time zone", value: describeTimeZone(timezone) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Church details</CardTitle>
        <CardDescription className="text-[15px]">
          What people see in the app and on your website.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="text-[15px] font-semibold text-foreground">{row.label}</dt>
              <dd className="text-[15px] text-foreground/80">{row.value.trim() || "Not added yet"}</dd>
            </div>
          ))}
          <div className="grid gap-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <dt className="text-[15px] font-semibold text-foreground">Service times</dt>
            <dd className="text-[15px] text-foreground/80">
              {basics.serviceTimes.length === 0 ? (
                "Not added yet"
              ) : (
                <ul className="space-y-1">
                  {basics.serviceTimes.map((row) => (
                    <li key={row.clientId}>
                      {row.label} · {DAYS[row.dayOfWeek] ?? ""} at {formatTime(row.startTime)}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
