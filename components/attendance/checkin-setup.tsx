"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, MapPin, QrCode, Smartphone, TabletSmartphone } from "lucide-react";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type StepId = "services" | "window" | "other" | "location";

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
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function dwellPhrase(policy: AttendanceSetupPolicy): string {
  if (!policy.requiresConfirmation || policy.minDwellSeconds === 0) return "phones count on arrival";
  const minutes = Math.round(policy.minDwellSeconds / 60);
  return `phones count after ${minutes} min`;
}

/** The switches that save the moment they are tapped. */
type Switches = Pick<AttendanceSetupPolicy, "geofenceEnabled" | "qrEnabled" | "kioskEnabled">;

/**
 * Attendance setup, in the order a church needs it: its service times first,
 * when check-in is open, the simple ways to check in (a code on a screen, a
 * tablet at the door), and last — optional — checking in on a phone the moment
 * it arrives. The map only appears once phone check-in is switched on.
 *
 * Whether phone check-in is live comes from the server — the same function a
 * phone's own request runs (`readChurchAutomaticReadiness`) — so this page
 * cannot say "ready" while phones are being refused.
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
  const phoneOn = switches.geofenceEnabled;
  const live = readiness.problem === null;
  const nextWindow = readiness.windows[0] ?? null;

  const tones: Record<StepId, StepTone> = {
    services:
      state.serviceTimes.length === 0 ? "todo" : state.upcoming.length > 0 ? "done" : "attention",
    // Sensible defaults exist, so these never block anything.
    window: "done",
    other: "done",
    location: readiness.watching.length > 0 ? "done" : hiddenOnly ? "attention" : "todo",
  };

  const firstOpen: StepId | null =
    tones.services !== "done" ? "services" : phoneOn && tones.location !== "done" ? "location" : null;
  const [open, setOpen] = useState<StepId | null>(firstOpen);
  const toggle = (step: StepId) => setOpen((current) => (current === step ? null : step));
  const openStep = (step: StepId | "phone") => {
    if (step !== "phone") setOpen(step);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document
        .getElementById(`setup-${step}`)
        ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  };

  // A link to one part of setup opens that step: `#setup-services` and the
  // like, and the section names the page had before — other pages still link
  // to `#locations`.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const legacy: Record<string, StepId | "phone"> = {
      locations: "location",
      "service-times": "services",
      "how-check-in-works": "window",
      "setup-live": "phone",
    };
    const named = hash.startsWith("setup-") ? hash.slice("setup-".length) : "";
    const step =
      legacy[hash] ??
      ((["services", "window", "other", "location", "phone"] as const).find((id) => id === named) ?? null);
    if (step) openStep(step);
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSwitch = (patch: Partial<Switches>, message: string, after?: () => void) => {
    const next = { ...switches, ...patch };
    setSwitches(next);
    startTransition(async () => {
      try {
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
        after?.();
        router.refresh();
      } catch {
        setSwitches(savedSwitches);
        toast.error("We couldn't save that change. Nothing was changed. Try again.");
      }
    });
  };

  const createCampus = () => {
    startTransition(async () => {
      try {
        const result = await addMainCampus();
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        setEditingCampus(result.data.campusId);
        router.refresh();
      } catch {
        toast.error("We couldn't add your building. Try again.");
      }
    });
  };

  const firstService = state.serviceTimes[0] ?? null;

  return (
    <div className="flex w-full flex-col gap-6">
      {!isAdmin && (
        <p className="rounded-2xl border border-border bg-muted px-5 py-4 text-[15px] text-muted-foreground">
          You can see how attendance is set up. Only a church admin can change it.
        </p>
      )}

      <SetupStep
        id="setup-services"
        number={1}
        title="Your service times"
        tone={tones.services}
        open={open === "services"}
        onToggle={() => toggle("services")}
        actionLabel={tones.services === "done" ? "Change" : "Add services"}
        summary={
          state.serviceTimes.length === 0
            ? "No services yet. Add them so they show up on Services."
            : state.serviceTimes
                .slice(0, 3)
                .map((service) => `${DAY_NAMES[service.dayOfWeek]} ${formatClock(service.startTime)}`)
                .join(" · ") +
              (state.serviceTimes.length > 3 ? ` · and ${state.serviceTimes.length - 3} more` : "")
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
        number={2}
        title="When check-in is open"
        tone={tones.window}
        open={open === "window"}
        onToggle={() => toggle("window")}
        actionLabel="Change"
        summary={`Opens ${minutesPhrase(policy.checkinOpensMinutesBefore)} before and closes ${minutesPhrase(policy.checkinClosesMinutesAfter)} after each service${phoneOn ? ` · ${dwellPhrase(policy)}` : ""}`}
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
          showPhoneOptions={phoneOn}
          onSaved={() => router.refresh()}
        />
      </SetupStep>

      <SetupStep
        id="setup-other"
        number={3}
        title="Ways to check in at church"
        tone={tones.other}
        open={open === "other"}
        onToggle={() => toggle("other")}
        actionLabel="Change"
        summary={`Scan a code: ${switches.qrEnabled ? "on" : "off"} · Welcome desk tablet: ${switches.kioskEnabled ? "on" : "off"} · Staff can always mark people on Services`}
      >
        <div className="flex flex-col gap-5">
          <SwitchRow
            id="setup-qr"
            icon={<QrCode className="size-5" aria-hidden />}
            title="Scan a code"
            checked={switches.qrEnabled}
            disabled={!isAdmin || pending}
            onChange={(value) =>
              saveSwitch({ qrEnabled: value }, value ? "Scanning a code is on." : "Scanning a code is off.")
            }
          >
            Show a changing code on a screen from the Services page; people
            scan it or type it in the app.
          </SwitchRow>
          <SwitchRow
            id="setup-kiosk"
            icon={<TabletSmartphone className="size-5" aria-hidden />}
            title="Welcome desk tablet"
            checked={switches.kioskEnabled}
            disabled={!isAdmin || pending}
            onChange={(value) =>
              saveSwitch({ kioskEnabled: value }, value ? "The welcome desk tablet is on." : "The welcome desk tablet is off.")
            }
          >
            A tablet at the door where a volunteer finds someone and checks
            them in.
          </SwitchRow>
          <p className="text-sm text-muted-foreground">
            Staff can always mark people on the Services page. Kids rooms have
            their own check-in under Kids Check-in.
          </p>
        </div>
      </SetupStep>

      <section
        id="setup-phone"
        aria-labelledby="setup-phone-title"
        className={cn(
          "scroll-mt-24 rounded-2xl border bg-card shadow-card dark:shadow-none",
          phoneOn ? "border-brand-gold/50" : "border-border",
        )}
      >
        <div className="flex items-start gap-4 p-5 sm:p-6">
          <span
            aria-hidden
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl",
              phoneOn && live
                ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Smartphone className="size-6" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <label
                id="setup-phone-title"
                htmlFor="setup-automatic"
                className="font-heading text-lg font-semibold text-foreground"
              >
                Let people check in on their phone when they arrive
              </label>
              <span className="text-sm font-medium text-muted-foreground">Optional</span>
            </div>
            <p id="setup-automatic-detail" className="text-[15px] leading-relaxed text-muted-foreground">
              People who turn it on in the FaithForm app are counted when their
              phone arrives at church during check-in. Their phone sends one
              reading on arrival, which is checked and thrown away: you see that
              they came, never where they were.
            </p>
            {phoneOn ? (
              <div className="pt-1">
                <StatusBadge tone={live ? "done" : "attention"}>
                  {live ? "Working" : "Switched on, not working yet"}
                </StatusBadge>
              </div>
            ) : null}
          </div>
          <Switch
            id="setup-automatic"
            checked={phoneOn}
            disabled={!isAdmin || pending}
            aria-describedby="setup-automatic-detail"
            onCheckedChange={(value) =>
              saveSwitch(
                { geofenceEnabled: value },
                value ? "Phone check-in is on." : "Phone check-in is off.",
                value && readiness.watching.length === 0 ? () => openStep("location") : undefined,
              )
            }
          />
        </div>

        {phoneOn ? (
          <div className="flex flex-col gap-5 border-t border-border px-5 pb-6 pt-5 sm:px-6">
            {!readiness.featureEnabled ? (
              <Callout>
                Attendance is switched off for this church by FaithForm, so phones
                aren&apos;t checked in. Contact support to turn it back on.
              </Callout>
            ) : readiness.problem === "no_campus_configured" ? (
              <Callout>
                One more step: put your building on the map below, so phones
                know where church is.
              </Callout>
            ) : null}

            <dl className="grid gap-4 rounded-xl bg-muted/50 p-4 sm:grid-cols-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-muted-foreground">Next check-in</dt>
                <dd className="text-[15px] font-semibold text-foreground">
                  {nextWindow
                    ? `${formatDay(nextWindow.checkinOpensAt, nextWindow.timezone)}, ${formatTime(nextWindow.checkinOpensAt, nextWindow.timezone)} to ${formatTime(nextWindow.checkinClosesAt, nextWindow.timezone)}`
                    : "No services in the next 7 days"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-muted-foreground">Using the app</dt>
                <dd className="text-[15px] font-semibold text-foreground">
                  {state.linkedPeople} {state.linkedPeople === 1 ? "person" : "people"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-muted-foreground">Turned phone check-in on</dt>
                <dd className="text-[15px] font-semibold text-foreground">
                  {state.optedInPeople !== null ? state.optedInPeople : `Fewer than ${CONSENT_COUNT_FLOOR}`}
                </dd>
              </div>
            </dl>

            <SetupStep
              id="setup-location"
              number={4}
              title="Where your church is"
              tone={tones.location}
              open={open === "location"}
              onToggle={() => toggle("location")}
              actionLabel={tones.location === "done" ? "Change" : "Set up"}
              summary={
                readiness.watching.length > 0
                  ? `On the map: ${readiness.watching.map((campus) => campus.campusName).join(", ")}`
                  : hiddenOnly
                    ? "Your building is hidden from the app"
                    : "Not on the map yet"
              }
            >
              <div className="flex flex-col gap-4">
                {state.campuses.length === 0 ? (
                  <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-5">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-brand-gold/15 text-accent">
                      <MapPin className="size-5" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-1">
                      <p className="font-semibold text-foreground">Put your church on the map</p>
                      <p className="text-[15px] text-muted-foreground">
                        Phones notice when they arrive near your building. Start
                        with your main building{churchAddress ? ` at ${churchAddress}` : ""};
                        other campuses can be added on the App page.
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
                  <p className="text-sm text-muted-foreground">
                    Another campus?{" "}
                    <Link href="/dashboard/app" className="font-semibold text-accent hover:underline">
                      Add it on the App page
                    </Link>
                    , then place it here.
                  </p>
                ) : null}
              </div>
            </SetupStep>

            <PhoneCheckCard
              phone={phone}
              churchName={churchName}
              readiness={{ problem: readiness.problem, watching: readiness.watching }}
              onOpenStep={(step) => openStep(step === "live" ? "phone" : "location")}
            />
          </div>
        ) : null}
      </section>

      <UpcomingCard upcoming={state.upcoming} phoneOn={phoneOn} />
    </div>
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
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
            {campus.name}
            {campus.isPrimary ? <StatusChip tone="info">Main</StatusChip> : null}
            {!campus.isPublic ? (
              <StatusChip tone="warn">Hidden from the app</StatusChip>
            ) : positioned ? (
              <StatusChip tone="good">On the map</StatusChip>
            ) : (
              <StatusChip tone="warn">No location yet</StatusChip>
            )}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {campus.address ?? churchAddress ?? "No address"}
          </span>
          {!campus.isPublic ? (
            <span className="text-sm text-amber-700 dark:text-amber-300">
              A hidden campus isn&apos;t used for phone check-in.{" "}
              <Link href="/dashboard/app" className="font-semibold underline">
                Show it on the App page
              </Link>
              .
            </span>
          ) : null}
        </div>
        {isAdmin && !editing ? (
          <Button variant={positioned ? "outline" : "default"} disabled={disabled} onClick={onEdit}>
            <MapPin className="size-4" aria-hidden />
            {positioned ? "Move the pin" : "Set location"}
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
    <div className="flex items-start gap-4">
      <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={id} className="text-base font-semibold text-foreground">
          {title}
        </label>
        <p id={`${id}-detail`} className="text-[15px] leading-relaxed text-muted-foreground">
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
    <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      {children}
    </p>
  );
}

function UpcomingCard({ upcoming, phoneOn }: { upcoming: SetupUpcomingService[]; phoneOn: boolean }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 dark:shadow-none">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <CalendarClock className="size-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold text-foreground">Coming up</h2>
          <p className="text-[15px] text-muted-foreground">
            Your next services and when check-in is open. Who came shows on{" "}
            <Link href="/dashboard/attendance/services" className="font-semibold text-accent hover:underline">
              Services
            </Link>{" "}
            and counts toward the Sunday count.
          </p>
        </div>
      </div>
      {upcoming.length === 0 ? (
        <p className="mt-4 text-[15px] text-muted-foreground">
          No upcoming services. Add your service times in step 1.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {upcoming.map((service) => (
            <li key={service.id} className="flex min-h-16 flex-wrap items-center justify-between gap-2 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-semibold text-foreground">
                  {service.label}
                  {service.campusName ? (
                    <span className="font-normal text-muted-foreground"> · {service.campusName}</span>
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatDay(service.startsAt, service.timezone)}, {formatTime(service.startsAt, service.timezone)}
                  {" · "}check-in {formatTime(service.checkinOpensAt, service.timezone)} to{" "}
                  {formatTime(service.checkinClosesAt, service.timezone)}
                </span>
              </div>
              {!phoneOn ? null : !service.automatic ? (
                <StatusChip tone="muted">Phone check-in off</StatusChip>
              ) : service.positioned ? (
                <StatusChip tone="good">Phone check-in on</StatusChip>
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
