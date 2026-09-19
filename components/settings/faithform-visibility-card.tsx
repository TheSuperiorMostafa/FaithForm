"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  retireCampus,
  saveCampus,
  saveDiscoverySettings,
} from "@/app/dashboard/settings/faithform-actions";
import type { Campus } from "@/lib/faithform/campuses";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type FaithFormVisibilityCardProps = {
  isAdmin: boolean;
  isDiscoverable: boolean;
  publicSummary: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
  slug: string | null;
  campuses: Campus[];
};

/**
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

const BLANK_CAMPUS = {
  name: "",
  slug: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  latitude: "",
  longitude: "",
  timezone: "America/New_York",
  geofenceRadiusM: "150",
  isActive: true,
  isPublic: true,
  isPrimary: false,
  sortKey: "0",
};

export function FaithFormVisibilityCard({
  isAdmin,
  isDiscoverable,
  publicSummary,
  joinPolicy,
  slug,
  campuses,
}: FaithFormVisibilityCardProps) {
  const [pending, startTransition] = useTransition();
  const [discoverable, setDiscoverable] = useState(isDiscoverable);
  const [summary, setSummary] = useState(publicSummary ?? "");
  const [policy, setPolicy] = useState(joinPolicy);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...BLANK_CAMPUS });

  const saveVisibility = () => {
    startTransition(async () => {
      const result = await saveDiscoverySettings({
        isDiscoverable: discoverable,
        publicSummary: summary.trim() || null,
        joinPolicy: policy,
      });
      if (result.ok) {
        toast.success("Saved.");
      } else {
        toast.error(result.message);
        setDiscoverable(isDiscoverable);
      }
    });
  };

  const startEdit = (campus: Campus) => {
    setEditing(campus.id);
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

  const submitCampus = () => {
    startTransition(async () => {
      const result = await saveCampus({
        campusId: editing ?? undefined,
        values: {
          ...draft,
          latitude: draft.latitude.trim() === "" ? null : draft.latitude,
          longitude: draft.longitude.trim() === "" ? null : draft.longitude,
          addressLine1: draft.addressLine1 || null,
          city: draft.city || null,
          state: draft.state || null,
          postalCode: draft.postalCode || null,
        },
      });
      if (result.ok) {
        toast.success(editing ? "Campus updated." : "Campus added.");
        setEditing(null);
        setDraft({ ...BLANK_CAMPUS });
      } else {
        toast.error(result.message);
      }
    });
  };

  const retire = (campusId: string) => {
    startTransition(async () => {
      const result = await retireCampus(campusId);
      if (result.ok) toast.success("Campus retired.");
      else toast.error(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How people find you in the app</CardTitle>
          <CardDescription>
            Prefer invitation links for your congregation. Turn search listing
            on only if you want people to add your church without a link. Off by
            default.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="faithform-discoverable" className="text-sm font-semibold">
                List this church in search
              </Label>
              <p className="text-xs text-muted-foreground">
                {slug
                  ? `People can search for you at ${slug} without an invitation link.`
                  : "Set a public web address for this church before listing it."}
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
            <Label htmlFor="faithform-summary">Search summary</Label>
            <Textarea
              id="faithform-summary"
              value={summary}
              maxLength={600}
              rows={3}
              disabled={!isAdmin || pending}
              placeholder="A sentence or two about who you are and what a first visit is like."
              onChange={(event) => setSummary(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Shown under your name in search results. Your full story goes in About on
              the church page.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={!isAdmin || pending}>
            <legend className="mb-1 text-sm font-semibold">Who can add your church</legend>
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
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <input
                        type="radio"
                        name="faithform-add-policy"
                        className="size-4 accent-accent"
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
                    <span className="text-xs text-muted-foreground">{option.detail}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Adding your church in the app never gives anyone access to this
            dashboard. Staff access is managed on the Team tab.
          </p>

          {isAdmin && (
            <div>
              <Button onClick={saveVisibility} disabled={pending}>
                {pending ? "Saving…" : "Save visibility"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Campuses</CardTitle>
          <CardDescription>
            Where your church meets. To place a campus on the map and set the
            area where people are checked in automatically, use{" "}
            <Link
              href="/dashboard/attendance/setup#locations"
              className="font-semibold text-accent hover:underline"
            >
              Automatic Attendance
            </Link>
            . A hidden campus is never used for automatic check-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {campuses.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No campuses yet. Your existing address and service times keep
              working exactly as they are.
            </p>
          )}

          {campuses.map((campus) => (
            <div
              key={campus.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">
                  {campus.name}
                  {campus.isPrimary && (
                    <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                      Main
                    </span>
                  )}
                  {!campus.isActive && (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      Retired
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[campus.addressLine1, campus.city, campus.state]
                    .filter(Boolean)
                    .join(", ") || "No address"}
                  {" · "}
                  {campus.timezone}
                </span>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => startEdit(campus)}
                  >
                    Edit
                  </Button>
                  {campus.isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => retire(campus.id)}
                    >
                      Retire
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}

          {isAdmin && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
              <p className="text-sm font-semibold">
                {editing ? "Edit campus" : "Add a campus"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Web address" hint="lowercase, e.g. east-campus">
                  <Input
                    value={draft.slug}
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  />
                </Field>
                <Field label="Street">
                  <Input
                    value={draft.addressLine1}
                    onChange={(e) =>
                      setDraft({ ...draft, addressLine1: e.target.value })
                    }
                  />
                </Field>
                <Field label="City">
                  <Input
                    value={draft.city}
                    onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                  />
                </Field>
                <Field label="Latitude" hint="optional, with longitude">
                  <Input
                    value={draft.latitude}
                    inputMode="decimal"
                    onChange={(e) =>
                      setDraft({ ...draft, latitude: e.target.value })
                    }
                  />
                </Field>
                <Field label="Longitude" hint="optional, with latitude">
                  <Input
                    value={draft.longitude}
                    inputMode="decimal"
                    onChange={(e) =>
                      setDraft({ ...draft, longitude: e.target.value })
                    }
                  />
                </Field>
                <Field label="Timezone">
                  <Input
                    value={draft.timezone}
                    onChange={(e) =>
                      setDraft({ ...draft, timezone: e.target.value })
                    }
                  />
                </Field>
                <Field label="Check-in radius (metres)" hint="50 to 500; 150 suits most churches">
                  <Input
                    value={draft.geofenceRadiusM}
                    inputMode="numeric"
                    onChange={(e) =>
                      setDraft({ ...draft, geofenceRadiusM: e.target.value })
                    }
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <ToggleField
                  id="campus-primary"
                  label="Main campus"
                  checked={draft.isPrimary}
                  onChange={(v) => setDraft({ ...draft, isPrimary: v })}
                />
                <ToggleField
                  id="campus-public"
                  label="Show publicly"
                  checked={draft.isPublic}
                  onChange={(v) => setDraft({ ...draft, isPublic: v })}
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={submitCampus} disabled={pending}>
                  {editing ? "Save campus" : "Add campus"}
                </Button>
                {editing && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setEditing(null);
                      setDraft({ ...BLANK_CAMPUS });
                    }}
                  >
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
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
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
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-xs font-semibold">
        {label}
      </Label>
    </div>
  );
}
