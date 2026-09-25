"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, ImageIcon, UsersRound } from "lucide-react";

import {
  createChurchForCurrentUser,
  createSetupAccount,
  type SetupAccountState,
  type SetupChurchState,
} from "@/app/setup/actions";
import { TimezoneSelect } from "@/components/admin/timezone-select";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { SuccessState } from "@/components/ui/success-state";
import { formatTimezoneLabel } from "@/lib/timezones";
import { cn } from "@/lib/utils";

import {
  CHURCH_INFO_HREF,
  SETUP_NEXT_STEPS,
  SETUP_START_DESCRIPTION,
  SETUP_START_TITLE,
} from "./setup-copy";

const FALLBACK_TIMEZONE = "America/New_York";

const setupInputClass = cn(
  "min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-base text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

type SetupStep = "start" | "church" | "done";

/** What the one-screen form returns: the account result, then the church's. */
type StartState = SetupAccountState & { churchError?: string; churchName?: string };

const startInitial: StartState = { ok: false };
const churchInitial: SetupChurchState = { ok: false };

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="h-12 w-full">
      {pending ? busy : idle}
    </Button>
  );
}

/** The browser already knows where the church is; asking is one more decision. */
function useBrowserTimezone(): [string | null, (tz: string) => void] {
  const [timezone, setTimezone] = useState<string | null>(null);
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE);
    } catch {
      setTimezone(FALLBACK_TIMEZONE);
    }
  }, []);
  return [timezone, setTimezone];
}

/**
 * Time zone, inferred and shown as one quiet line. "Change" opens the full
 * picker for the rare pastor setting up from somewhere else. The server still
 * validates whatever arrives.
 */
function TimezoneField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (tz: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <input type="hidden" name="timezone" value={value ?? ""} />
      {editing ? (
        <TimezoneSelect id="setup-timezone" value={value ?? FALLBACK_TIMEZONE} onChange={onChange} />
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 text-base text-muted-foreground">
          <span>
            Time zone:{" "}
            <span className="font-semibold text-foreground">
              {value ? formatTimezoneLabel(value) : "Finding your time zone…"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 hover:text-accent dark:text-accent"
          >
            Change
          </button>
        </p>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  ...input
}: React.ComponentProps<"input"> & { id: string; label: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-semibold">
        {label}
      </label>
      <input id={id} className={setupInputClass} {...input} />
      {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-base text-foreground"
    >
      {children}
    </div>
  );
}

export function SetupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-3xl border border-border bg-card px-6 py-8 shadow-card sm:px-10 sm:py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle variant="compact" />
      </div>
      {children}
    </div>
  );
}

export function SetupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <Logo size={64} priority className="mb-4" />
      <h1 className="font-heading text-[28px] font-bold leading-tight text-foreground">{title}</h1>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * One screen: your name, your church's name, your email and a password. The
 * time zone comes from the browser. Everything else (logo, address, service
 * times, team) waits on Home as a short checklist, so the pastor is in the
 * product within a minute.
 *
 * Under the hood it is still the two existing server actions, in order:
 * create the account, then create the church for the signed-in account. If
 * the project needs an email confirmation first, the church name travels in
 * the account's own details and is filled back in when the link returns here.
 */
export function SetupFlow({
  initialStep,
  signedInEmail,
  pendingChurchName,
}: {
  initialStep: "account" | "church";
  signedInEmail: string | null;
  pendingChurchName?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(initialStep === "account" ? "start" : "church");
  const [churchName, setChurchName] = useState(pendingChurchName ?? "");
  const [createdName, setCreatedName] = useState("");
  const [timezone, setTimezone] = useBrowserTimezone();

  const [startState, startAction] = useActionState(
    async (state: StartState, formData: FormData): Promise<StartState> => {
      const account = await createSetupAccount(state, formData);
      if (!account.ok || account.needsEmailConfirmation) return account;

      // The account's session cookie came back with the first action, so the
      // second one runs as the new admin.
      const church = await createChurchForCurrentUser(churchInitial, formData);
      if (church.ok) {
        setCreatedName(formData.get("name")?.toString().trim() ?? "");
        setStep("done");
        return { ok: true };
      }
      // The account exists now; only the church is left. Keep what they typed.
      setStep("church");
      return { ok: false, churchError: church.error };
    },
    startInitial,
  );

  const [churchState, churchAction] = useActionState(
    async (state: SetupChurchState, formData: FormData) => {
      const result = await createChurchForCurrentUser(state, formData);
      if (result.ok) {
        setCreatedName(formData.get("name")?.toString().trim() ?? "");
        setStep("done");
      }
      return result;
    },
    churchInitial,
  );

  if (step === "done") {
    return (
      <SetupDone
        churchName={createdName}
        onContinue={() => {
          router.replace("/dashboard");
          router.refresh();
        }}
      />
    );
  }

  if (startState.ok && startState.needsEmailConfirmation) {
    return (
      <SetupCard>
        <SetupHeading
          title="Check your email"
          description="We sent you a link to confirm your email. Open it and you'll come straight back here to finish. We've kept your church's name."
        />
        <p className="text-center text-base text-muted-foreground">
          It can take a minute to arrive. Check your spam folder if you don&apos;t see it.
        </p>
      </SetupCard>
    );
  }

  const churchError = step === "church" ? churchState.error ?? startState.churchError : undefined;

  return (
    <SetupCard>
      {step === "start" ? (
        <>
          <SetupHeading title={SETUP_START_TITLE} description={SETUP_START_DESCRIPTION} />
          <form action={startAction} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="setup-first"
                name="firstName"
                label="First name"
                autoComplete="given-name"
                required
              />
              <Field
                id="setup-last"
                name="lastName"
                label="Last name"
                autoComplete="family-name"
              />
            </div>

            <Field
              id="setup-church-name"
              name="name"
              label="Church name"
              required
              maxLength={120}
              value={churchName}
              onChange={(event) => setChurchName(event.target.value)}
              placeholder="Grace Community Church"
            />

            <Field
              id="setup-email"
              name="email"
              type="email"
              label="Your email"
              autoComplete="email"
              required
              placeholder="you@yourchurch.org"
            />

            <Field
              id="setup-password"
              name="password"
              type="password"
              label="Choose a password"
              autoComplete="new-password"
              required
              minLength={8}
              hint="At least 8 characters. You'll use it to sign in."
            />

            <TimezoneField value={timezone} onChange={setTimezone} />

            {startState.error && (
              <FormError>
                {startState.error}
                {startState.existingAccount && (
                  <Link
                    href="/login"
                    className="mt-2 flex min-h-11 items-center font-semibold underline underline-offset-4"
                  >
                    Go to sign in
                  </Link>
                )}
              </FormError>
            )}

            <SubmitButton idle="Create my church" busy="Setting up your church…" />
          </form>
        </>
      ) : (
        <>
          <SetupHeading
            title="Name your church"
            description={
              signedInEmail
                ? `You're signed in as ${signedInEmail}. One last thing: what's your church called?`
                : "One last thing: what's your church called?"
            }
          />
          <form action={churchAction} className="space-y-5">
            <Field
              id="setup-church-name"
              name="name"
              label="Church name"
              required
              maxLength={120}
              value={churchName}
              onChange={(event) => setChurchName(event.target.value)}
              placeholder="Grace Community Church"
            />

            <TimezoneField value={timezone} onChange={setTimezone} />

            {churchError && <FormError>{churchError}</FormError>}

            <SubmitButton idle="Create my church" busy="Setting up your church…" />
          </form>
        </>
      )}

      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 text-center text-base text-muted-foreground">
        Already using FaithForm?
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 hover:text-accent dark:text-accent"
        >
          Sign in
        </Link>
      </p>
    </SetupCard>
  );
}

const NEXT_STEP_ICONS = {
  serviceTimes: CalendarClock,
  logo: ImageIcon,
  team: UsersRound,
} as const;

/** The last screen: it worked, here's what's next, one button onward. */
function SetupDone({ churchName, onContinue }: { churchName: string; onContinue: () => void }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <SetupCard>
      <SuccessState
        className="border-0 bg-transparent px-0 py-2 dark:bg-transparent"
        title={churchName ? `${churchName} is ready` : "Your church is ready"}
        description="You're the admin. Here's what most churches do next. You'll find the same list on your Home page."
        actions={
          <Button
            type="button"
            size="lg"
            className="h-12 w-full sm:w-auto"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              onContinue();
            }}
          >
            {leaving ? "Opening FaithForm…" : "Go to FaithForm"}
          </Button>
        }
      >
        <ul className="w-full space-y-3 text-left">
          {SETUP_NEXT_STEPS.map((item) => {
            const Icon = NEXT_STEP_ICONS[item.key];
            return (
              <li
                key={item.key}
                className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3"
              >
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-primary dark:text-accent"
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <span className="text-base text-foreground">{item.label}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-base text-muted-foreground">
          Your logo, address and service times live in{" "}
          <Link
            href={CHURCH_INFO_HREF}
            className="font-semibold text-primary underline underline-offset-4 dark:text-accent"
          >
            Settings → Church info
          </Link>
          .
        </p>
      </SuccessState>
    </SetupCard>
  );
}

/**
 * Loading state for /setup while it checks whether someone is signed in.
 * Headings and labels are fixed text and render for real; only the boxes
 * shimmer. Mirrors the one-screen form, which is what a new visitor sees.
 */
export function SetupSkeleton() {
  const label = (text: string) => <p className="mb-2 text-base font-semibold">{text}</p>;
  const box = <Skeleton className="h-12 w-full rounded-[10px]" />;
  return (
    <SkeletonContainer label="Set up your church">
      <SetupCard>
        <SetupHeading title={SETUP_START_TITLE} description={SETUP_START_DESCRIPTION} />
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>{label("First name")}{box}</div>
            <div>{label("Last name")}{box}</div>
          </div>
          <div>{label("Church name")}{box}</div>
          <div>{label("Your email")}{box}</div>
          <div>
            {label("Choose a password")}
            {box}
            <p className="mt-2 text-sm text-muted-foreground">
              At least 8 characters. You&apos;ll use it to sign in.
            </p>
          </div>
          <Skeleton className="h-11 w-64 max-w-full" />
          <Skeleton className="h-12 w-full rounded-[10px]" />
        </div>
        <p className="mt-6 flex min-h-11 items-center justify-center text-center text-base text-muted-foreground">
          Already using FaithForm? Sign in
        </p>
      </SetupCard>
    </SkeletonContainer>
  );
}
