"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";

import { findAddress } from "@/app/dashboard/attendance/setup/actions";
import {
  retireCampus,
  saveCampus,
  saveDiscoverySettings,
} from "@/app/dashboard/settings/faithform-actions";
import {
  COMMON_TIME_ZONES,
  campusSlugFrom,
  defaultCampusTimeZone,
  timeZoneLabel,
} from "@/components/member-app/campus-helpers";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Campus } from "@/lib/faithform/campuses";

export type FaithFormVisibilityCardProps = {
  isAdmin: boolean;
  isDiscoverable: boolean;
  publicSummary: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
  slug: string | null;
  campuses: Campus[];
  /** Address lookup lives with phone check-in, so it needs that feature. */
  canFindAddress?: boolean;
};

/**
 * How people find the church in the FaithForm app, and where it meets.
 *
 * The Church App page's copy of the old Settings card: the campus form now asks
 * for a name and an address, and keeps map position, time zone and the
 * check-in distance under "More options" with plain labels and defaults.
 *
 * The app has one way in — a person adds their church — so the only real
 * question is whether that needs an invitation. `approval_required` is kept
 * as a stored value for app builds already installed, and reads as "Anyone".
 */
const ADD_POLICY_OPTIONS = [
  {
    key: "anyone",
    title: "Anyone who finds you",
    detail: "People can add your church from search or from your invitation link.",
  },
  {
    key: "invite_only",
    title: "Only with an invitation link",
    detail: "Only people you send a link to can add your church.",
  },
] as const;

type Draft = {
  name: string;
  slug: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: string;
  longitude: string;
  timezone: string;
  geofenceRadiusM: string;
  isActive: boolean;
  isPublic: boolean;
  isPrimary: boolean;
  sortKey: string;
};

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** `browserZone` is only passed after mount, so server and browser render alike. */
function blankCampus(campuses: Campus[], browserZone: string | null = null): Draft {
  return {
    name: "",
    slug: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
    latitude: "",
    longitude: "",
    timezone: defaultCampusTimeZone(campuses, browserZone),
    geofenceRadiusM: "150",
    isActive: true,
    isPublic: true,
    isPrimary: false,
    sortKey: "0",
  };
}

export function FaithFormVisibilityCard({
  isAdmin,
  isDiscoverable,
  publicSummary,
  joinPolicy,
  slug,
  campuses,
  canFindAddress = false,
}: FaithFormVisibilityCardProps) {
  const [pending, startTransition] = useTransition();
  const [looking, startLooking] = useTransition();
  const [discoverable, setDiscoverable] = useState(isDiscoverable);
  const [summary, setSummary] = useState(publicSummary ?? "");
  const [policy, setPolicy] = useState(joinPolicy);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blankCampus(campuses));
  // The web-address part follows the name until someone changes it by hand.
  const [slugTouched, setSlugTouched] = useState(false);
  const [placeFound, setPlaceFound] = useState<string | null>(null);

  // Once in the browser, a church with no campuses yet starts from this
  // computer's own time zone rather than Eastern.
  useEffect(() => {
    if (campuses.length > 0) return;
    const zone = defaultCampusTimeZone(campuses, browserTimeZone());
    setDraft((current) =>
      current.name === "" && current.timezone !== zone ? { ...current, timezone: zone } : current,
    );
  }, [campuses]);

  const saveVisibility = () => {
    startTransition(async () => {
      const result = await saveDiscoverySettings({
        isDiscoverable: discoverable,
        publicSummary: summary.trim() || null,
        joinPolicy: policy,
      });
      if (result.ok) {
        toast.success(
          discoverable
            ? "Saved. Your church is listed in app search."
            : "Saved. Your church isn't listed in app search.",
        );
      } else {
        toast.error(result.message);
        setDiscoverable(isDiscoverable);
      }
    });
  };

  const resetForm = () => {
    setEditing(null);
    setDraft(blankCampus(campuses, browserTimeZone()));
    setSlugTouched(false);
    setPlaceFound(null);
  };

  const startEdit = (campus: Campus) => {
    setEditing(campus.id);
    setSlugTouched(true);
    setPlaceFound(null);
    setDraft({
      name: campus.name,
      slug: campus.slug,
      addressLine1: campus.addressLine1 ?? "",
      city: campus.city ?? "",
      state: campus.state ?? "",
      postalCode: campus.postalCode ?? "",
      country: "US",
      latitude: campus.latitude === null ? "" : String(campus.latitude),
      longitude: campus.longitude === null ? "" : String(campus.longitude),
      timezone: campus.timezone,
      geofenceRadiusM: String(campus.geofenceRadiusM),
      isActive: campus.isActive,
      isPublic: campus.isPublic,
      isPrimary: campus.isPrimary,
      sortKey: String(campus.sortKey),
    });
  };

  const lookUpAddress = () => {
    const query = [draft.addressLine1, draft.city, draft.state, draft.postalCode]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");
    if (!query) {
      toast.error("Type the street and city first.");
      return;
    }
    startLooking(async () => {
      const result = await findAddress(query);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const match = result.data[0];
      if (!match) {
        toast.error("We couldn't find that address. Check the street and city, or place it on the map in Attendance.");
        return;
      }
      setDraft((current) => ({
        ...current,
        latitude: match.latitude.toFixed(6),
        longitude: match.longitude.toFixed(6),
      }));
      setPlaceFound(match.label);
    });
  };

  const submitCampus = () => {
    const name = draft.name.trim();
    const values = {
      ...draft,
      slug: draft.slug.trim() || campusSlugFrom(name),
      latitude: draft.latitude.trim() === "" ? null : draft.latitude,
      longitude: draft.longitude.trim() === "" ? null : draft.longitude,
      addressLine1: draft.addressLine1 || null,
      city: draft.city || null,
      state: draft.state || null,
      postalCode: draft.postalCode || null,
    };
    startTransition(async () => {
      const result = await saveCampus({ campusId: editing ?? undefined, values });
      if (result.ok) {
        toast.success(editing ? `${name} updated.` : `${name} added.`);
        resetForm();
      } else {
        toast.error(result.message);
      }
    });
  };

  const retire = async (campus: Campus) => {
    const ok = await confirmAction({
      title: `Retire ${campus.name}?`,
      description: `${campus.name} stops appearing in the app, and phones stop checking people in there. Upcoming services linked to it are updated. Its past attendance stays in your records.`,
      confirmLabel: "Retire campus",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await retireCampus(campus.id);
      if (result.ok) toast.success(`${campus.name} retired.`);
      else toast.error(result.message);
    });
  };

  const zoneOptions = COMMON_TIME_ZONES.some((zone) => zone.value === draft.timezone)
    ? COMMON_TIME_ZONES
    : [{ value: draft.timezone, label: timeZoneLabel(draft.timezone) }, ...COMMON_TIME_ZONES];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">How people find you in the app</CardTitle>
          <CardDescription className="text-[15px]">
            Invitation links are the easiest way in for your congregation. Turn
            on search listing only if you want people to add your church without
            a link. It&apos;s off to start with.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-background p-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="faithform-discoverable" className="text-[15px] font-semibold">
                List this church in search
              </Label>
              <p className="text-sm text-muted-foreground">
                {slug
                  ? "People can find your church by name without an invitation link."
                  : "Your church needs a web address before it can be listed. Ask FaithForm support to set one."}
              </p>
            </div>
            <Switch
              id="faithform-discoverable"
              checked={discoverable}
              disabled={!isAdmin || pending || !slug}
              onCheckedChange={setDiscoverable}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="faithform-summary" className="text-[15px] font-semibold">
              Search summary
            </Label>
            <Textarea
              id="faithform-summary"
              value={summary}
              maxLength={600}
              rows={3}
              disabled={!isAdmin || pending}
              placeholder="A sentence or two about who you are and what a first visit is like."
              onChange={(event) => setSummary(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Shown under your name in search results. Your full story goes in
              About on your church page.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={!isAdmin || pending}>
            <legend className="mb-1 text-[15px] font-semibold">Who can add your church</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ADD_POLICY_OPTIONS.map((option) => {
                const selected =
                  option.key === "invite_only"
                    ? policy === "invite_only"
                    : policy !== "invite_only";
                return (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition-colors ${
                      selected
                        ? "border-accent bg-accent/10"
                        : "border-border bg-background hover:border-accent/50"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                      <input
                        type="radio"
                        name="faithform-add-policy"
                        className="size-5 accent-accent"
                        checked={selected}
                        onChange={() =>
                          setPolicy(
                            option.key === "invite_only"
                              ? "invite_only"
                              : joinPolicy === "invite_only"
                                ? "open"
                                : joinPolicy,
                          )
                        }
                      />
                      {option.title}
                    </span>
                    <span className="text-sm text-muted-foreground">{option.detail}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Adding your church in the app never gives anyone access to this
            dashboard. Staff access is managed in Settings → Team.
          </p>

          {isAdmin && (
            <div>
              <Button onClick={saveVisibility} disabled={pending}>
                {pending ? "Saving…" : "Save how people find you"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Campuses</CardTitle>
          <CardDescription className="text-[15px]">
            Where your church meets. To place a campus exactly on the map and
            choose where people are checked in by phone, use{" "}
            <Link
              href="/dashboard/attendance/setup#locations"
              className="font-semibold text-accent hover:underline"
            >
              Attendance › Setup
            </Link>
            . A hidden campus is never used for phone check-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {campuses.length === 0 && (
            <p className="text-[15px] text-muted-foreground">
              No campuses yet. Your church address and service times keep
              working exactly as they are.
            </p>
          )}

          {campuses.map((campus) => (
            <div
              key={campus.id}
              className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                  {campus.name}
                  {campus.isPrimary && <StatusBadge tone="ready">Main</StatusBadge>}
                  {!campus.isActive && <StatusBadge tone="neutral">Retired</StatusBadge>}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[campus.addressLine1, campus.city, campus.state]
                    .filter(Boolean)
                    .join(", ") || "No address"}
                  {" · "}
                  {timeZoneLabel(campus.timezone)}
                </span>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => startEdit(campus)}
                  >
                    Edit
                  </Button>
                  {campus.isActive && (
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={pending}
                      onClick={() => void retire(campus)}
                    >
                      Retire
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}

          {isAdmin && (
            <div className="flex flex-col gap-4 rounded-xl border border-dashed border-border p-5">
              <p className="text-base font-semibold">
                {editing ? `Edit ${draft.name || "campus"}` : "Add a campus"}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campus name" htmlFor="campus-name">
                  <Input
                    id="campus-name"
                    value={draft.name}
                    placeholder="East Campus"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        name: e.target.value,
                        slug: slugTouched ? draft.slug : campusSlugFrom(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Street address" htmlFor="campus-street">
                  <Input
                    id="campus-street"
                    value={draft.addressLine1}
                    onChange={(e) => setDraft({ ...draft, addressLine1: e.target.value })}
                  />
                </Field>
                <Field label="City" htmlFor="campus-city">
                  <Input
                    id="campus-city"
                    value={draft.city}
                    onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="State" htmlFor="campus-state">
                    <Input
                      id="campus-state"
                      value={draft.state}
                      onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                    />
                  </Field>
                  <Field label="ZIP" htmlFor="campus-zip">
                    <Input
                      id="campus-zip"
                      value={draft.postalCode}
                      inputMode="numeric"
                      onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <ToggleField
                  id="campus-primary"
                  label="Main campus"
                  checked={draft.isPrimary}
                  onChange={(v) => setDraft({ ...draft, isPrimary: v })}
                />
                <ToggleField
                  id="campus-public"
                  label="Show in the app"
                  checked={draft.isPublic}
                  onChange={(v) => setDraft({ ...draft, isPublic: v })}
                />
              </div>

              <AdvancedSection
                title="More options"
                description="Map position, time zone, and how close counts as “here”. The defaults suit most churches."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Time zone"
                    htmlFor="campus-timezone"
                    hint="Service times at this campus are in this time zone."
                  >
                    <Select
                      id="campus-timezone"
                      value={draft.timezone}
                      onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                    >
                      {zoneOptions.map((zone) => (
                        <option key={zone.value} value={zone.value}>
                          {zone.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="How close counts as “here” (metres)"
                    htmlFor="campus-radius"
                    hint="Between 50 and 500. 150 suits most churches."
                  >
                    <Input
                      id="campus-radius"
                      value={draft.geofenceRadiusM}
                      inputMode="numeric"
                      onChange={(e) => setDraft({ ...draft, geofenceRadiusM: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">Place on the map</p>
                      <p className="text-sm text-muted-foreground">
                        {draft.latitude && draft.longitude
                          ? placeFound
                            ? `Found: ${placeFound}`
                            : "This campus has a map position."
                          : "Not placed yet. Phone check-in needs this."}
                      </p>
                    </div>
                    {canFindAddress ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={lookUpAddress}
                        disabled={looking}
                      >
                        {looking ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Search className="size-4" aria-hidden />
                        )}
                        Find from the address
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Latitude" htmlFor="campus-lat" hint="Filled in for you when you find the address.">
                      <Input
                        id="campus-lat"
                        value={draft.latitude}
                        inputMode="decimal"
                        onChange={(e) => setDraft({ ...draft, latitude: e.target.value })}
                      />
                    </Field>
                    <Field label="Longitude" htmlFor="campus-lng">
                      <Input
                        id="campus-lng"
                        value={draft.longitude}
                        inputMode="decimal"
                        onChange={(e) => setDraft({ ...draft, longitude: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Link
                    href="/dashboard/attendance/setup#locations"
                    className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-semibold text-accent hover:underline"
                  >
                    <MapPin className="size-4" aria-hidden /> Place it on a map instead
                  </Link>
                </div>

                <Field
                  label="Web address name"
                  htmlFor="campus-slug"
                  hint="Made from the campus name. Lowercase letters, numbers and dashes."
                >
                  <Input
                    id="campus-slug"
                    value={draft.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setDraft({ ...draft, slug: e.target.value });
                    }}
                  />
                </Field>
              </AdvancedSection>

              <div className="flex flex-wrap gap-3">
                <Button onClick={submitCampus} disabled={pending || !draft.name.trim()}>
                  {editing ? "Save campus" : "Add campus"}
                </Button>
                {editing && (
                  <Button variant="outline" disabled={pending} onClick={resetForm}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[15px] font-semibold">
        {label}
      </Label>
      {children}
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

function ToggleField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </Label>
    </div>
  );
}
