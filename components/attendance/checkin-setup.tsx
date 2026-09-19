"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, MapPin, QrCode, Radio, TabletSmartphone } from "lucide-react";
import { toast } from "sonner";

import {
  addMainCampus,
  saveCheckinPolicy,
  type CheckinSetupView,
} from "@/app/dashboard/attendance/setup/actions";
import type {
  AttendanceSetupPolicy,
  SetupCampus,
  SetupUpcomingService,
} from "@/lib/attendance/v2/setup";
import { CONSENT_COUNT_FLOOR } from "@/lib/attendance/v2/setup-bounds";
import { DAY_NAMES, formatClock, minutesPhrase } from "@/lib/attendance/v2/setup-view";
import { CampusLocationEditor } from "@/components/attendance/campus-location-editor";
import { CampusRadiusMap } from "@/components/attendance/campus-radius-map";
import { CheckinWindowEditor } from "@/components/attendance/checkin-window-editor";
import { PhoneCheckCard } from "@/components/attendance/phone-check-card";
import { ServiceScheduleEditor } from "@/components/attendance/service-schedule-editor";
import { SetupStep, StatusChip, type StepTone } from "@/components/attendance/setup-step";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type StepId = "location" | "services" | "window" | "live";

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

function dwellPhrase(policy: AttendanceSetupPolicy): string {
  if (!policy.requiresConfirmation || policy.minDwellSeconds === 0) return "counts on arrival";
  const minutes = Math.round(policy.minDwellSeconds / 60);
  return `counts after ${minutes} min`;
}

/** The switches that save the moment they are tapped. */
type Switches = Pick<AttendanceSetupPolicy, "geofenceEnabled" | "qrEnabled" | "kioskEnabled">;

/**
 * Check-in setup, as four steps a church goes through once: put the building
 * on the map, list the weekly services, choose when check-in opens, and switch
 * it on.
 *
 * Whether it is live comes from the server — the same function a phone's own
 * request runs (`readChurchAutomaticReadiness`) — so this page cannot say
 * "ready" while phones are being refused, which is how a church could be shown
 * its campus on a map while the app said it had no location.
 *
 * Every change applies to the services whose check-in has not opened yet, as
 * soon as it is saved.
 */
export function CheckinSetup({
  view,
  isAdmin,
}: {
  view: CheckinSetupView;
  isAdmin: boolean;
}) {
  const { state, readiness, phone, churchAddress, churchName } = view;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingCampus, setEditingCampus] = useState<string | null>(null);

  const policy = state.policy;
  const savedSwitches: Switches = {
    geofenceEnabled: policy.geofenceEnabled,
    qrEnabled: policy.qrEnabled,
    kioskEnabled: policy.kioskEnabled,
  };
  const [switches, setSwitches] = useState<Switches>(savedSwitches);
  const switchesKey = JSON.stringify(savedSwitches);
  useEffect(() => {
    setSwitches(JSON.parse(switchesKey) as Switches);
  }, [switchesKey]);

  const positioned = state.campuses.filter(
    (campus) => campus.latitude !== null && campus.longitude !== null,
  );
  const hiddenOnly = readiness.watching.length === 0 && positioned.some((campus) => !campus.isPublic);
  const live = readiness.problem === null;
  const nextWindow = readiness.windows[0] ?? null;

  const tones: Record<StepId, StepTone> = {
    location: readiness.watching.length > 0 ? "done" : hiddenOnly ? "attention" : "todo",
    services:
      state.serviceTimes.length === 0 ? "todo" : state.upcoming.length > 0 ? "done" : "attention",
    // Sensible defaults exist, so this never blocks going live.
    window: "done",
    live: live ? "done" : readiness.switchedOn ? "attention" : "todo",
  };
  const doneCount = Object.values(tones).filter((tone) => tone === "done").length;

  const firstOpen = (["location", "services", "live"] as StepId[]).find(
    (step) => tones[step] !== "done",
  );
  const [open, setOpen] = useState<StepId | null>(firstOpen ?? null);
  const toggle = (step: StepId) => setOpen((current) => (current === step ? null : step));
  const openStep = (step: StepId) => {
    setOpen(step);
    requestAnimationFrame(() =>
      document.getElementById(`setup-${step}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  // A link to one part of setup opens that step: `#setup-location` and the
  // like, and the section names the page had before it was steps — other pages
  // still link to `#locations`.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const legacy: Record<string, StepId> = {
      locations: "location",
      "service-times": "services",
      "how-check-in-works": "window",
    };
    const named = hash.startsWith("setup-") ? hash.slice("setup-".length) : "";
    const step =
      legacy[hash] ??
      ((["location", "services", "window", "live"] as const).find((id) => id === named) ?? null);
    if (step) openStep(step);
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSwitch = (patch: Partial<Switches>, message: string) => {
    const next = { ...switches, ...patch };
    setSwitches(next);
    startTransition(async () => {
      const result = await saveCheckinPolicy({
        ...next,
        checkinOpensMinutesBefore: policy.checkinOpensMinutesBefore,
        checkinClosesMinutesAfter: policy.checkinClosesMinutesAfter,
        requiresConfirmation: policy.requiresConfirmation,
        minDwellSeconds: policy.requiresConfirmation ? policy.minDwellSeconds : 0,
        maxLocationAccuracyM: policy.maxLocationAccuracyM,
      });
      if (!result.ok) {
        setSwitches(savedSwitches);
        toast.error(result.message);
        return;
      }
      toast.success(message);
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

  const firstService = state.serviceTimes[0] ?? null;

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Automatic Attendance
          </h1>
          <LiveBadge live={live} switchedOn={readiness.switchedOn} />
        </div>
        <p className="text-sm text-muted-foreground">
          Where people arrive, when your services are, and how they&apos;re
          checked in — including automatically, when their phone arrives.
        </p>
      </header>

      {!isAdmin && (
        <p className="rounded-xl border border-border bg-muted p-3 text-sm text-muted-foreground">
          You can see how check-in is set up. Only a church admin can change it.
        </p>
      )}

      <StatusCard
        live={live}
        doneCount={doneCount}
        watching={readiness.watching}
        nextWindow={nextWindow}
        linkedPeople={state.linkedPeople}
        optedInPeople={state.optedInPeople}
        problem={readiness.problem}
        featureEnabled={readiness.featureEnabled}
        onContinue={() =>
          openStep(readiness.problem === "no_campus_configured" ? "location" : firstOpen ?? "live")
        }
      />

      <SetupStep
        id="setup-location"
        number={1}
        title="Where people arrive"
        tone={tones.location}
        open={open === "location"}
        onToggle={() => toggle("location")}
        actionLabel={tones.location === "done" ? "Change" : "Set up"}
        summary={
          readiness.watching.length > 0
            ? readiness.watching
                .map((campus) => `${campus.campusName} · ${campus.radiusMeters} m circle`)
                .join(" · ")
            : hiddenOnly
              ? "Your campus on the map is hidden from the app"
              : "Not on the map yet"
        }
      >
        <div className="flex flex-col gap-3">
          {state.campuses.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-gold/15 text-accent">
                <MapPin className="size-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-semibold text-foreground">Put your church on the map</p>
                <p className="text-sm text-muted-foreground">
                  Phones watch a circle around your building. Start with your
                  main building{churchAddress ? ` at ${churchAddress}` : ""};
                  other campuses can be added on the Member App page.
                </p>
              </div>
              {isAdmin ? (
                <Button onClick={createCampus} disabled={pending}>
                  <MapPin className="size-4" aria-hidden />
                  Set your church&apos;s location
                </Button>
              ) : null}
            </div>
          ) : null}

          {state.campuses.map((campus) => (
            <CampusCard
              key={campus.id}
              campus={campus}
              editing={editingCampus === campus.id}
              isAdmin={isAdmin}
              disabled={pending}
              churchAddress={churchAddress}
              onEdit={() => setEditingCampus(campus.id)}
              onDone={() => {
                setEditingCampus(null);
                router.refresh();
              }}
              onCancel={() => setEditingCampus(null)}
            />
          ))}

          {state.campuses.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Another campus?{" "}
              <Link href="/dashboard/app" className="font-semibold text-accent hover:underline">
                Add it on the Member App page
              </Link>
              , then place it here.
            </p>
          ) : null}
        </div>
      </SetupStep>

      <SetupStep
        id="setup-services"
        number={2}
        title="When your services are"
        tone={tones.services}
        open={open === "services"}
        onToggle={() => toggle("services")}
        actionLabel={tones.services === "done" ? "Change" : "Add services"}
        summary={
          state.serviceTimes.length === 0
            ? "No weekly services yet"
            : state.serviceTimes
                .slice(0, 3)
                .map(
                  (service) =>
                    `${DAY_NAMES[service.dayOfWeek]?.slice(0, 3)} ${formatClock(service.startTime)}`,
                )
                .join(" · ") +
              (state.serviceTimes.length > 3 ? ` · +${state.serviceTimes.length - 3} more` : "")
        }
      >
        <ServiceScheduleEditor
          key={state.serviceTimes.map((service) => service.id).join(",")}
          serviceTimes={state.serviceTimes}
          campuses={state.campuses}
          isAdmin={isAdmin}
          onSaved={() => router.refresh()}
          opensMinutesBefore={policy.checkinOpensMinutesBefore}
          closesMinutesAfter={policy.checkinClosesMinutesAfter}
        />
      </SetupStep>

      <SetupStep
        id="setup-window"
        number={3}
        title="When check-in is open"
        tone={tones.window}
        open={open === "window"}
        onToggle={() => toggle("window")}
        actionLabel="Change"
        summary={`Opens ${minutesPhrase(policy.checkinOpensMinutesBefore)} before · closes ${minutesPhrase(policy.checkinClosesMinutesAfter)} after · ${dwellPhrase(policy)}`}
      >
        <CheckinWindowEditor
          key={JSON.stringify([
            policy.checkinOpensMinutesBefore,
            policy.checkinClosesMinutesAfter,
            policy.requiresConfirmation,
            policy.minDwellSeconds,
            policy.maxLocationAccuracyM,
          ])}
          policy={policy}
          sample={
            firstService
              ? {
                  label: firstService.label,
                  startTime: firstService.startTime,
                  endTime: firstService.endTime,
                }
              : null
          }
          isAdmin={isAdmin}
          onSaved={() => router.refresh()}
        />
      </SetupStep>

      <SetupStep
        id="setup-live"
        number={4}
        title="Go live"
        tone={tones.live}
        open={open === "live"}
        onToggle={() => toggle("live")}
        actionLabel={live ? "Change" : "Turn on"}
        summary={
          live
            ? "Automatic check-in is on"
            : readiness.switchedOn
              ? "Switched on, but not live yet"
              : "Automatic check-in is off"
        }
      >
        <div className="flex flex-col gap-5">
          <SwitchRow
            id="setup-automatic"
            icon={<Radio className="size-5" aria-hidden />}
            title="Automatic check-in"
            checked={switches.geofenceEnabled}
            disabled={!isAdmin || pending}
            onChange={(value) =>
              saveSwitch(
                { geofenceEnabled: value },
                value ? "Automatic check-in is on." : "Automatic check-in is off.",
              )
            }
          >
            People who turn it on in the FaithForm app are checked in when
            their phone arrives during a service&apos;s check-in window. It&apos;s
            optional for each person. Their phone sends one reading on
            arrival, which FaithForm checks against your circle and discards:
            you see that they came, never where they were.
          </SwitchRow>

          {readiness.switchedOn && readiness.problem === "no_campus_configured" ? (
            <Callout>
              It&apos;s switched on, but phones have no location to watch yet.{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => openStep("location")}
              >
                Put your building on the map
              </button>
              .
            </Callout>
          ) : null}
          {readiness.switchedOn && !readiness.featureEnabled ? (
            <Callout>
              Attendance is switched off for this church by FaithForm, so phones
              aren&apos;t checked in. Contact support to turn it back on.
            </Callout>
          ) : null}

          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Other ways to check in
            </p>
            <SwitchRow
              id="setup-qr"
              icon={<QrCode className="size-5" aria-hidden />}
              title="Scan a code"
              checked={switches.qrEnabled}
              disabled={!isAdmin || pending}
              onChange={(value) =>
                saveSwitch({ qrEnabled: value }, value ? "Code check-in is on." : "Code check-in is off.")
              }
            >
              Show a changing code on a screen from the Services page; people
              scan it or type it in the app. Works for anyone, with or without
              automatic check-in.
            </SwitchRow>
            <SwitchRow
              id="setup-kiosk"
              icon={<TabletSmartphone className="size-5" aria-hidden />}
              title="Welcome desk kiosk"
              checked={switches.kioskEnabled}
              disabled={!isAdmin || pending}
              onChange={(value) =>
                saveSwitch({ kioskEnabled: value }, value ? "The kiosk is on." : "The kiosk is off.")
              }
            >
              A tablet at the door where a volunteer finds someone and checks
              them in.
            </SwitchRow>
            <p className="text-xs text-muted-foreground">
              Staff can always mark people present on the Services page, and
              kids&apos; rooms have their own check-in.
            </p>
          </div>
        </div>
      </SetupStep>

      <PhoneCheckCard
        phone={phone}
        churchName={churchName}
        readiness={{ problem: readiness.problem, watching: readiness.watching }}
        onOpenStep={(step) => openStep(step)}
      />

      <UpcomingCard upcoming={state.upcoming} />
    </div>
  );
}

function LiveBadge({ live, switchedOn }: { live: boolean; switchedOn: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold",
        live
          ? "border-green-300/70 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span className="relative flex size-2.5">
        {live ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:animate-none" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2.5 rounded-full",
            live ? "bg-green-500" : switchedOn ? "bg-amber-500" : "bg-slate-400",
          )}
        />
      </span>
      {live ? "Live" : switchedOn ? "Not live yet" : "Off"}
    </span>
  );
}

function StatusCard({
  live,
  doneCount,
  watching,
  nextWindow,
  linkedPeople,
  optedInPeople,
  problem,
  featureEnabled,
  onContinue,
}: {
  live: boolean;
  doneCount: number;
  watching: { campusName: string; radiusMeters: number }[];
  nextWindow: CheckinSetupView["readiness"]["windows"][number] | null;
  linkedPeople: number;
  optedInPeople: number | null;
  problem: CheckinSetupView["readiness"]["problem"];
  featureEnabled: boolean;
  onContinue: () => void;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border p-5 shadow-card dark:shadow-none",
        live
          ? "border-green-300/60 bg-gradient-to-br from-green-50 to-card dark:border-green-500/25 dark:from-green-500/10"
          : "border-brand-gold/40 bg-gradient-to-br from-brand-gold/10 to-card",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-bold text-foreground">
            {live ? "Automatic check-in is live" : "Get automatic check-in live"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {live
              ? `Phones watch ${watching.map((campus) => campus.campusName).join(", ")}. People are counted when they arrive during a check-in window.`
              : problem === "geofence_disabled" && featureEnabled
                ? "Finish the steps below, then switch it on."
                : problem === "no_campus_configured"
                  ? "It's switched on — put your building on the map and phones can start."
                  : "Attendance is switched off for this church by FaithForm."}
          </p>
        </div>
        {!live && problem !== null ? (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={onContinue}
          >
            {problem === "no_campus_configured" ? "Set the location" : "Continue setup"}
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex gap-1.5" aria-label={`${doneCount} of 4 steps done`} role="img">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < doneCount ? (live ? "bg-green-500" : "bg-accent") : "bg-muted",
            )}
          />
        ))}
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Next check-in</dt>
          <dd className="font-semibold text-foreground">
            {nextWindow
              ? `${formatDay(nextWindow.checkinOpensAt, nextWindow.timezone)}, ${formatTime(nextWindow.checkinOpensAt, nextWindow.timezone)} – ${formatTime(nextWindow.checkinClosesAt, nextWindow.timezone)}`
              : live
                ? "No services in the next 7 days"
                : "—"}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Connected to the app</dt>
          <dd className="font-semibold text-foreground">
            {linkedPeople} {linkedPeople === 1 ? "person" : "people"}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Turned automatic check-in on</dt>
          <dd className="font-semibold text-foreground">
            {optedInPeople !== null ? optedInPeople : `Fewer than ${CONSENT_COUNT_FLOOR}`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function CampusCard({
  campus,
  editing,
  isAdmin,
  disabled,
  churchAddress,
  onEdit,
  onDone,
  onCancel,
}: {
  campus: SetupCampus;
  editing: boolean;
  isAdmin: boolean;
  disabled: boolean;
  churchAddress: string | null;
  onEdit: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const positioned = campus.latitude !== null && campus.longitude !== null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {campus.name}
            {campus.isPrimary ? <StatusChip tone="info">Main</StatusChip> : null}
            {!campus.isPublic ? (
              <StatusChip tone="warn">Hidden from the app</StatusChip>
            ) : positioned ? (
              <StatusChip tone="good">On the map · {campus.radiusMeters} m</StatusChip>
            ) : (
              <StatusChip tone="warn">No location yet</StatusChip>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {campus.address ?? churchAddress ?? "No address"}
          </span>
          {!campus.isPublic ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              A hidden campus isn&apos;t used for automatic check-in.{" "}
              <Link href="/dashboard/app" className="font-semibold underline">
                Show it on the Member App page
              </Link>
              .
            </span>
          ) : null}
        </div>
        {isAdmin && !editing ? (
          <Button variant={positioned ? "outline" : "default"} size="sm" disabled={disabled} onClick={onEdit}>
            <MapPin className="size-4" aria-hidden />
            {positioned ? "Move" : "Set location"}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <CampusLocationEditor
          campus={campus}
          churchAddress={churchAddress}
          onSaved={onDone}
          onCancel={onCancel}
        />
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

function SwitchRow({
  id,
  icon,
  title,
  checked,
  disabled,
  onChange,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-semibold text-foreground">
          {title}
        </label>
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      {children}
    </p>
  );
}

function UpcomingCard({ upcoming }: { upcoming: SetupUpcomingService[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5 dark:shadow-none">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <CalendarClock className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-base font-semibold text-foreground">Coming up</h2>
          <p className="text-sm text-muted-foreground">
            The next services and their check-in windows. Check-ins appear on{" "}
            <Link href="/dashboard/attendance/services" className="font-semibold text-accent hover:underline">
              Services
            </Link>{" "}
            and count on the weekly sheet.
          </p>
        </div>
      </div>
      {upcoming.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No upcoming services. Add your service times in step 2.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {upcoming.map((service) => (
            <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground">
                  {service.label}
                  {service.campusName ? (
                    <span className="font-normal text-muted-foreground"> · {service.campusName}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDay(service.startsAt, service.timezone)}, {formatTime(service.startsAt, service.timezone)}
                  {" · "}check-in {formatTime(service.checkinOpensAt, service.timezone)}–
                  {formatTime(service.checkinClosesAt, service.timezone)}
                </span>
              </div>
              {!service.automatic ? (
                <StatusChip tone="muted">Automatic off</StatusChip>
              ) : service.positioned ? (
                <StatusChip tone="good">Automatic on</StatusChip>
              ) : (
                <StatusChip tone="warn">No location</StatusChip>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
