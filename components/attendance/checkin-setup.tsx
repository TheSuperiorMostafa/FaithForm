"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, MapPin } from "lucide-react";
import { toast } from "sonner";

import {
  addMainCampus,
  saveCheckinPolicy,
} from "@/app/dashboard/attendance/setup/actions";
import type {
  AttendanceSetupPolicy,
  AttendanceSetupState,
  SetupCampus,
  SetupUpcomingService,
} from "@/lib/attendance/v2/setup";
import { CONSENT_COUNT_FLOOR } from "@/lib/attendance/v2/setup-bounds";
import { CampusLocationEditor } from "@/components/attendance/campus-location-editor";
import { CampusRadiusMap } from "@/components/attendance/campus-radius-map";
import { ServiceScheduleEditor } from "@/components/attendance/service-schedule-editor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const OPENS_BEFORE_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const CLOSES_AFTER_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const DWELL_OPTIONS = [
  { seconds: 0, label: "As soon as they arrive" },
  { seconds: 60, label: "After 1 minute" },
  { seconds: 120, label: "After 2 minutes (recommended)" },
  { seconds: 180, label: "After 3 minutes" },
  { seconds: 300, label: "After 5 minutes" },
  { seconds: 600, label: "After 10 minutes" },
  { seconds: 900, label: "After 15 minutes" },
];
const ACCURACY_OPTIONS = [
  { meters: 50, label: "Strict (within 50 m)" },
  { meters: 100, label: "Standard (within 100 m, recommended)" },
  { meters: 150, label: "Relaxed (within 150 m)" },
  { meters: 200, label: "Lenient (within 200 m)" },
];

function minutesLabel(minutes: number, when: "before" | "after"): string {
  if (minutes === 0) return when === "before" ? "When the service starts" : "When the service ends";
  if (minutes < 60) return `${minutes} minutes ${when}`;
  const hours = minutes / 60;
  return `${hours === 1 ? "1 hour" : `${hours} hours`} ${when}`;
}

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** Window preview for a service, recomputed from the unsaved choices. */
function previewWindow(
  service: SetupUpcomingService,
  opensBefore: number,
  closesAfter: number,
): { opens: string; closes: string } {
  const opens = new Date(Date.parse(service.startsAt) - opensBefore * 60_000).toISOString();
  const closes = new Date(Date.parse(service.endsAt) + closesAfter * 60_000).toISOString();
  return {
    opens: formatTime(opens, service.timezone),
    closes: formatTime(closes, service.timezone),
  };
}

type PolicyDraft = Omit<AttendanceSetupPolicy, "policyVersion" | "updatedAt">;

function draftFrom(policy: AttendanceSetupPolicy): PolicyDraft {
  return {
    geofenceEnabled: policy.geofenceEnabled,
    qrEnabled: policy.qrEnabled,
    kioskEnabled: policy.kioskEnabled,
    checkinOpensMinutesBefore: policy.checkinOpensMinutesBefore,
    checkinClosesMinutesAfter: policy.checkinClosesMinutesAfter,
    requiresConfirmation: policy.requiresConfirmation,
    minDwellSeconds: policy.requiresConfirmation ? policy.minDwellSeconds : 0,
    maxLocationAccuracyM: policy.maxLocationAccuracyM,
  };
}

/** The closest wait the menu offers, never "as soon as they arrive". */
function nearestDwell(seconds: number): number {
  return DWELL_OPTIONS.filter((option) => option.seconds > 0).reduce((best, option) =>
    Math.abs(option.seconds - seconds) < Math.abs(best.seconds - seconds) ? option : best,
  ).seconds;
}

/**
 * Check-in setup, in the order a church needs it: where it is, when services
 * are, how check-in works, and whether automatic check-in is on.
 *
 * Every change to the policy, a location or the service times is applied to
 * the services whose check-in has not opened yet, straight away. That is said on
 * the page, so nobody expects an edit to change how a service already under way
 * is being judged.
 */
export function CheckinSetup({
  state,
  isAdmin,
}: {
  state: AttendanceSetupState;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<PolicyDraft>(() => draftFrom(state.policy));
  const [editingCampus, setEditingCampus] = useState<string | null>(null);

  // When the saved policy itself changes, take it as the new draft. Keyed on the
  // saved values rather than the object, so saving a location or the service
  // times (which refreshes the page) does not throw away unsaved edits here.
  const savedKey = JSON.stringify(draftFrom(state.policy));
  useEffect(() => {
    setDraft(JSON.parse(savedKey) as PolicyDraft);
  }, [savedKey]);

  const dirty = savedKey !== JSON.stringify(draft);

  const positionedCampuses = state.campuses.filter(
    (campus) => campus.latitude !== null && campus.longitude !== null,
  );
  const usableCampuses = positionedCampuses.filter((campus) => campus.isPublic);
  const nextService = state.upcoming[0] ?? null;

  const checks = [
    {
      done: usableCampuses.length > 0,
      title: "Your church's location is set",
      detail:
        usableCampuses.length > 0
          ? `${usableCampuses.length === 1 ? usableCampuses[0].name : `${usableCampuses.length} campuses`} on the map.`
          : positionedCampuses.length > 0
            ? "Your located campuses are hidden from the app. Show one publicly on the Member App page."
            : "Place your building on the map below.",
    },
    {
      done: state.serviceTimes.length > 0 && state.upcoming.length > 0,
      title: "Service times are set",
      detail:
        state.serviceTimes.length === 0
          ? "Add your weekly services below."
          : nextService
            ? `Next: ${nextService.label}, ${formatDay(nextService.startsAt, nextService.timezone)} at ${formatTime(nextService.startsAt, nextService.timezone)}.`
            : "No upcoming services yet. Save your service times to create them.",
    },
    {
      done: state.policy.geofenceEnabled,
      title: "Automatic check-in is on",
      detail: state.policy.geofenceEnabled
        ? "People who turn it on in the app can be checked in."
        : "Turn it on below when the steps above are done.",
    },
    {
      done: state.linkedPeople > 0,
      title: "People are connected to the app",
      detail:
        state.linkedPeople > 0
          ? `${state.linkedPeople} ${state.linkedPeople === 1 ? "person has" : "people have"} an app account connected to their record here. ${
              state.optedInPeople !== null
                ? `${state.optedInPeople} have turned on automatic check-in.`
                : `Fewer than ${CONSENT_COUNT_FLOOR} have turned on automatic check-in so far.`
            }`
          : "Automatic check-in only works for people whose app account is connected to their record in People.",
    },
  ];
  const remaining = checks.filter((check) => !check.done).length;

  const savePolicy = () => {
    startTransition(async () => {
      const result = await saveCheckinPolicy({
        ...draft,
        minDwellSeconds: draft.requiresConfirmation ? draft.minDwellSeconds : 0,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Check-in settings saved. Upcoming services now use them.");
      router.refresh();
    });
  };

  const setAutomaticCheckin = (enabled: boolean) => {
    const nextDraft = { ...draft, geofenceEnabled: enabled };
    setDraft(nextDraft);

    // The primary switch is a commitment, not a form field. Persist it as soon
    // as it is tapped so the phone-sized dashboard cannot leave the church in
    // an unsaved state with the Save button below the fold.
    startTransition(async () => {
      const result = await saveCheckinPolicy({
        ...nextDraft,
        minDwellSeconds: nextDraft.requiresConfirmation ? nextDraft.minDwellSeconds : 0,
      });
      if (!result.ok) {
        setDraft((current) => ({ ...current, geofenceEnabled: state.policy.geofenceEnabled }));
        toast.error(result.message);
        return;
      }

      setDraft(draftFrom(result.data.policy));
      toast.success(enabled ? "Automatic check-in is on." : "Automatic check-in is off.");
      router.refresh();
    });
  };

  const createCampus = () => {
    startTransition(async () => {
      const result = await addMainCampus();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setEditingCampus(result.data.campusId);
      router.refresh();
    });
  };

  const dwellSelected = draft.requiresConfirmation
    ? nearestDwell(draft.minDwellSeconds)
    : 0;

  return (
    <div className="flex w-full flex-col gap-5">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          Check-in setup
        </h1>
        <p className="text-sm text-muted-foreground">
          Where your church is, when services happen, and the ways people can
          check in, including automatically when they arrive.
        </p>
      </div>

      {!isAdmin && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          You can see how check-in is set up. Only a church admin can change it.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {remaining === 0 ? "Automatic check-in is ready" : "Getting automatic check-in ready"}
          </CardTitle>
          <CardDescription>
            {remaining === 0
              ? "People who turn it on in the FaithForm app are checked in when they arrive for a service."
              : `${remaining} ${remaining === 1 ? "step" : "steps"} left.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {checks.map((check) => (
              <li key={check.title} className="flex gap-3">
                {check.done ? (
                  <CircleCheck className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground">
                    {check.title}
                    <span className="sr-only">{check.done ? " (done)" : " (not yet)"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{check.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Card id="locations">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Where your church is</CardTitle>
          <CardDescription>
            Phones watch for arrival within a circle around each campus. The
            address and circle are the only place phones are told about, and
            people&rsquo;s own locations are never shown to you.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state.campuses.length === 0 && (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4">
              <p className="text-sm text-muted-foreground">
                No location yet. Start with your main building; you can add
                other campuses on the Member App page.
              </p>
              {isAdmin && (
                <Button onClick={createCampus} disabled={pending}>
                  <MapPin className="size-4" aria-hidden />
                  Set your church&rsquo;s location
                </Button>
              )}
            </div>
          )}

          {state.campuses.map((campus) => (
            <CampusRow
              key={campus.id}
              campus={campus}
              editing={editingCampus === campus.id}
              isAdmin={isAdmin}
              disabled={pending}
              onEdit={() => setEditingCampus(campus.id)}
              onDone={() => {
                setEditingCampus(null);
                router.refresh();
              }}
              onCancel={() => setEditingCampus(null)}
            />
          ))}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Card id="service-times">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">When services happen</CardTitle>
          <CardDescription>
            Your weekly services. Check-in is only ever open around these, so
            nobody is checked in for passing the building on a Tuesday.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceScheduleEditor
            key={state.serviceTimes.map((service) => service.id).join(",")}
            serviceTimes={state.serviceTimes}
            campuses={state.campuses}
            isAdmin={isAdmin}
            onSaved={() => router.refresh()}
          />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Card id="how-check-in-works">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How check-in works</CardTitle>
          <CardDescription>
            Changes apply to every service whose check-in hasn&rsquo;t opened
            yet. Turning automatic check-in off takes effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <fieldset disabled={!isAdmin || pending} className="flex flex-col gap-5">
            <ToggleRow
              id="setup-automatic"
              title="Automatic check-in"
              checked={draft.geofenceEnabled}
              onChange={setAutomaticCheckin}
              disabled={!isAdmin || pending}
            >
              People who turn this on in the FaithForm app are checked in when
              their phone arrives at your church during a service&rsquo;s
              check-in window. It&rsquo;s optional for each person, and they
              can turn it off at any time. Their phone sends one location
              reading on arrival; FaithForm checks it against your campus and
              then discards it. You see that they attended, never where they
              were.
              {isAdmin ? " This switch saves immediately." : ""}
            </ToggleRow>

            <ToggleRow
              id="setup-qr"
              title="Scan a code"
              checked={draft.qrEnabled}
              onChange={(value) => setDraft({ ...draft, qrEnabled: value })}
              disabled={!isAdmin || pending}
            >
              Show a changing code on a screen from the Services page; people
              scan it or type it in the app. Works for anyone, with or without
              automatic check-in.
            </ToggleRow>

            <ToggleRow
              id="setup-kiosk"
              title="Welcome desk kiosk"
              checked={draft.kioskEnabled}
              onChange={(value) => setDraft({ ...draft, kioskEnabled: value })}
              disabled={!isAdmin || pending}
            >
              A tablet at the door where a volunteer finds someone and checks
              them in.
            </ToggleRow>

            <p className="text-xs text-muted-foreground">
              Staff can always mark people present from the Services page.
            </p>

            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-opens" className="text-xs font-semibold">
                  Check-in opens
                </Label>
                <Select
                  id="setup-opens"
                  value={draft.checkinOpensMinutesBefore}
                  onChange={(event) =>
                    setDraft({ ...draft, checkinOpensMinutesBefore: Number(event.target.value) })
                  }
                >
                  {withCurrent(OPENS_BEFORE_OPTIONS, draft.checkinOpensMinutesBefore).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutesLabel(minutes, "before")}
                    </option>
                  ))}
                </Select>
                <span className="text-[11px] text-muted-foreground">Before the service starts</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-closes" className="text-xs font-semibold">
                  Check-in closes
                </Label>
                <Select
                  id="setup-closes"
                  value={draft.checkinClosesMinutesAfter}
                  onChange={(event) =>
                    setDraft({ ...draft, checkinClosesMinutesAfter: Number(event.target.value) })
                  }
                >
                  {withCurrent(CLOSES_AFTER_OPTIONS, draft.checkinClosesMinutesAfter).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutesLabel(minutes, "after")}
                    </option>
                  ))}
                </Select>
                <span className="text-[11px] text-muted-foreground">After the service ends</span>
              </div>
            </div>

            {nextService ? (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                For {nextService.label} on {formatDay(nextService.startsAt, nextService.timezone)}{" "}
                ({formatTime(nextService.startsAt, nextService.timezone)} to{" "}
                {formatTime(nextService.endsAt, nextService.timezone)}), check-in would be open
                from {previewWindow(nextService, draft.checkinOpensMinutesBefore, draft.checkinClosesMinutesAfter).opens}{" "}
                to {previewWindow(nextService, draft.checkinOpensMinutesBefore, draft.checkinClosesMinutesAfter).closes}.
              </p>
            ) : null}

            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-dwell" className="text-xs font-semibold">
                  Count someone automatically
                </Label>
                <Select
                  id="setup-dwell"
                  value={dwellSelected}
                  onChange={(event) => {
                    const seconds = Number(event.target.value);
                    setDraft({
                      ...draft,
                      requiresConfirmation: seconds > 0,
                      minDwellSeconds: seconds,
                    });
                  }}
                >
                  {DWELL_OPTIONS.map((option) => (
                    <option key={option.seconds} value={option.seconds}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  Waiting a couple of minutes means someone driving past or
                  dropping off isn&rsquo;t counted. Phones may take a little
                  longer than this to confirm.
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-accuracy" className="text-xs font-semibold">
                  Location accuracy needed
                </Label>
                <Select
                  id="setup-accuracy"
                  value={nearestAccuracy(draft.maxLocationAccuracyM)}
                  onChange={(event) =>
                    setDraft({ ...draft, maxLocationAccuracyM: Number(event.target.value) })
                  }
                >
                  {ACCURACY_OPTIONS.map((option) => (
                    <option key={option.meters} value={option.meters}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  Phones indoors are often less precise. A reading less precise
                  than this isn&rsquo;t used.
                </span>
              </div>
            </div>
          </fieldset>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={savePolicy} disabled={pending || !dirty}>
                {pending ? "Saving…" : "Save check-in settings"}
              </Button>
              {dirty && (
                <Button
                  variant="outline"
                  onClick={() => setDraft(draftFrom(state.policy))}
                  disabled={pending}
                >
                  Undo changes
                </Button>
              )}
              {state.lastChangedAt && (
                <span className="text-xs text-muted-foreground">
                  Last changed{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(state.lastChangedAt))}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coming up</CardTitle>
          <CardDescription>
            The next services and their check-in windows. Automatic check-ins
            appear on the{" "}
            <Link href="/dashboard/attendance/services" className="font-semibold text-accent hover:underline">
              Services
            </Link>{" "}
            page marked &ldquo;Automatic&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming services. Add service times above.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {state.upcoming.map((service) => (
                <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-foreground">
                      {service.label}
                      {service.campusName ? (
                        <span className="font-normal text-muted-foreground"> · {service.campusName}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDay(service.startsAt, service.timezone)},{" "}
                      {formatTime(service.startsAt, service.timezone)}. Check-in{" "}
                      {formatTime(service.checkinOpensAt, service.timezone)} to{" "}
                      {formatTime(service.checkinClosesAt, service.timezone)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      service.automatic && service.positioned
                        ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {!service.automatic
                      ? "Automatic check-in off"
                      : service.positioned
                        ? "Automatic check-in on"
                        : "No location for this service"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function nearestAccuracy(meters: number): number {
  return ACCURACY_OPTIONS.reduce((best, option) =>
    Math.abs(option.meters - meters) < Math.abs(best.meters - meters) ? option : best,
  ).meters;
}

/** The preset list, plus the saved value when it is not one of them. */
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function ToggleRow({
  id,
  title,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  title: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-sm font-semibold">
          {title}
        </Label>
        <p id={`${id}-detail`} className="text-xs leading-relaxed text-muted-foreground">
          {children}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-detail`}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function CampusRow({
  campus,
  editing,
  isAdmin,
  disabled,
  onEdit,
  onDone,
  onCancel,
}: {
  campus: SetupCampus;
  editing: boolean;
  isAdmin: boolean;
  disabled: boolean;
  onEdit: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const positioned = campus.latitude !== null && campus.longitude !== null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">
            {campus.name}
            {campus.isPrimary && (
              <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                Main
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {campus.address ?? "No address"}
            {" · "}
            {positioned ? `Check-in area ${campus.radiusMeters} m` : "No location yet"}
          </span>
          {!campus.isPublic && (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Hidden from the app, so it can&rsquo;t be used for automatic check-in.
            </span>
          )}
        </div>
        {isAdmin && !editing && (
          <Button variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
            {positioned ? "Change location" : "Set location"}
          </Button>
        )}
      </div>

      {editing ? (
        <CampusLocationEditor campus={campus} onSaved={onDone} onCancel={onCancel} />
      ) : positioned ? (
        <CampusRadiusMap
          latitude={campus.latitude as number}
          longitude={campus.longitude as number}
          radiusMeters={campus.radiusMeters}
        />
      ) : null}
    </div>
  );
}
