"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Mail, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { isAuthFragment } from "@/lib/auth/recovery-fragment";
import { cn } from "@/lib/utils";
import {
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  type LoginFormState,
  type PasswordLoginState,
  type PasswordResetState,
} from "./actions";
import { WRONG_PASSWORD_MESSAGE } from "./auth-messages";

const magicInitial: LoginFormState = { ok: false };
const passwordInitial: PasswordLoginState = { ok: false };
const resetInitial: PasswordResetState = { ok: false };

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="h-12 w-full">
      {pending ? busy : idle}
    </Button>
  );
}

const loginInputClass = cn(
  "min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-base text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

/** Quiet text button that is still a full 44px target. */
const textButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-[10px] px-3 text-base font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent";

type Mode = "magic" | "password" | "reset";

const SIGN_IN_OPTIONS: {
  mode: Exclude<Mode, "reset">;
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    mode: "password",
    icon: KeyRound,
    title: "Use my password",
    description: "Type your email and password.",
  },
  {
    mode: "magic",
    icon: Mail,
    title: "Email me a sign-in link",
    description: "No password needed.",
  },
];

/** The frame every state of the sign-in card shares, so nothing jumps. */
export function LoginCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-3xl border border-border bg-card px-6 py-8 shadow-card sm:px-10 sm:py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle variant="compact" />
      </div>
      {children}
    </div>
  );
}

export function LoginHeading({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <Logo size={64} priority className="mb-4" />
      <h1 className="font-heading text-[28px] font-bold leading-tight text-foreground">{title}</h1>
      {description && (
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupComplete = searchParams.get("notice") === "setup_complete";
  // /auth/callback lands here with ?error=auth when a link could not be
  // exchanged — expired, already used, or truncated. Saying so beats the
  // previous behaviour, which was a bare sign-in form with no explanation.
  //
  // Held in state and stripped from the URL, rather than read from it on every
  // render. Left in the address bar it outlives the failure it describes: it
  // survives a reload, a switch to the password tab, and a fresh magic-link
  // request, so a stale "that link expired" sits above a form that is working
  // and reads as a new error arriving before anything was even sent.
  const [linkFailed, setLinkFailed] = useState(
    () => searchParams.get("error") === "auth",
  );

  // A reset link from the phone apps carries its session in the URL fragment.
  // When its `redirect_to` is not on Supabase's allow-list, Supabase sends it
  // to the bare Site URL instead of /auth/callback, the root page redirects on
  // to here, and the fragment rides along — to a page with nothing that reads
  // it. The path is lost but the answer is not, so send it to the page that
  // does read it. A full load rather than a client navigation, so the fragment
  // arrives exactly as Supabase wrote it.
  useEffect(() => {
    if (isAuthFragment(window.location.hash)) {
      window.location.replace(`/auth/confirm${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    if (searchParams.get("error") !== "auth") return;
    const next = new URLSearchParams(searchParams);
    next.delete("error");
    const query = next.toString();
    router.replace(query ? `/login?${query}` : "/login", { scroll: false });
  }, [router, searchParams]);
  // Password first: teammates are set up with a temporary password, so that is
  // the path most people arrive on. The emailed sign-in link sits right beside
  // it as an equal, clearly labelled choice for anyone who has forgotten theirs.
  const [mode, setMode] = useState<Mode>("password");
  // Carried between the two choices so switching never makes anyone retype.
  const [email, setEmail] = useState("");

  const [magicState, magicAction] = useActionState(sendMagicLink, magicInitial);
  const [resetState, resetAction] = useActionState(sendPasswordReset, resetInitial);
  const [passwordState, passwordAction] = useActionState(
    async (state: PasswordLoginState, formData: FormData) => {
      const result = await signInWithPassword(state, formData);
      if (result.ok) {
        router.replace("/dashboard");
        router.refresh();
      }
      return result;
    },
    passwordInitial,
  );

  if ((mode === "magic" && magicState.ok) || (mode === "reset" && resetState.ok)) {
    return (
      <LoginCard>
        <LoginHeading
          title="Check your email"
          description={
            mode === "magic"
              ? `We sent a sign-in link to ${email || "your email"}. Open it on this phone or computer and you'll be signed in.`
              : "If that email has a FaithForm account, a link to choose a new password is on its way."
          }
        />
        <p className="text-center text-base text-muted-foreground">
          It can take a minute to arrive. Check your spam folder if you don&apos;t see it.
        </p>
        <button
          type="button"
          onClick={() => setMode("password")}
          className={cn(textButtonClass, "mt-6")}
        >
          Back to sign in
        </button>
      </LoginCard>
    );
  }

  if (mode === "reset") {
    return (
      <LoginCard>
        <LoginHeading
          title="Reset your password"
          description="Enter your email and we'll send you a link to choose a new one."
        />

        <form action={resetAction} className="space-y-5">
          <EmailField id="email-reset" value={email} onChange={setEmail} />

          {resetState.error && <FormError>{resetState.error}</FormError>}

          <SubmitButton idle="Email me a reset link" busy="Sending…" />
        </form>

        <button
          type="button"
          onClick={() => setMode("password")}
          className={cn(textButtonClass, "mt-4")}
        >
          Back to sign in
        </button>
      </LoginCard>
    );
  }

  const wrongPassword = passwordState.error === WRONG_PASSWORD_MESSAGE;

  return (
    <LoginCard>
      <LoginHeading title="Sign in to FaithForm" description="How would you like to sign in?" />

      {setupComplete && (
        <p className="mb-6 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-base text-foreground">
          Your church is already set up. Sign in to continue.
        </p>
      )}
      {linkFailed && (
        <p
          className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-base text-foreground"
          role="alert"
        >
          That sign-in link has expired or was already used. Sign in below, or
          email yourself a new link.
        </p>
      )}

      <SignInChoice mode={mode} onChange={setMode} />

      {mode === "magic" ? (
        <form
          action={magicAction}
          onSubmit={() => setLinkFailed(false)}
          className="mt-6 space-y-5"
        >
          <EmailField id="email-magic" value={email} onChange={setEmail} />

          {magicState.error && <FormError>{magicState.error}</FormError>}

          <SubmitButton idle="Email me a sign-in link" busy="Sending link…" />
          <p className="text-center text-base text-muted-foreground">
            We&apos;ll email you a link. Open it and you&apos;re signed in.
          </p>
        </form>
      ) : (
        <form
          action={passwordAction}
          onSubmit={() => setLinkFailed(false)}
          className="mt-6 space-y-5"
        >
          <EmailField id="email-pw" value={email} onChange={setEmail} />

          <div>
            <label htmlFor="password" className="mb-2 block text-base font-semibold">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={loginInputClass}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              New to the team? Use the temporary password your church admin gave you.
            </p>
          </div>

          {passwordState.error && (
            <FormError>
              {passwordState.error}
              {wrongPassword && (
                <button
                  type="button"
                  onClick={() => setMode("magic")}
                  className="mt-2 inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4"
                >
                  Email me a sign-in link instead
                </button>
              )}
            </FormError>
          )}

          <SubmitButton idle="Sign in" busy="Signing in…" />

          <button type="button" onClick={() => setMode("reset")} className={textButtonClass}>
            Forgot password?
          </button>
        </form>
      )}
    </LoginCard>
  );
}

/**
 * The two ways in, as two big labelled choices rather than a small toggle.
 * Pressed-button semantics, so a screen reader hears which one is chosen.
 */
export function SignInChoice({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange?: (mode: Exclude<Mode, "reset">) => void;
}) {
  return (
    <div role="group" aria-label="How to sign in" className="grid gap-3 sm:grid-cols-2">
      {SIGN_IN_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange?.(option.mode)}
            className={cn(
              "flex min-h-[76px] items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected
                ? "border-accent bg-accent/10"
                : "border-border bg-background hover:border-accent/50 hover:bg-accent/5",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                selected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-snug text-foreground">
                {option.title}
              </span>
              <span className="block text-sm text-muted-foreground">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmailField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-semibold">
        Email
      </label>
      <input
        id={id}
        name="email"
        type="email"
        autoComplete="email"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="you@yourchurch.org"
        className={loginInputClass}
      />
    </div>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-base text-foreground"
    >
      {children}
    </div>
  );
}

/**
 * Loading state for /login. Everything on the sign-in card is fixed text, so
 * it renders for real; only the input boxes shimmer until the form is ready.
 * Same card, same spacing, same default choice as the loaded form.
 */
export function LoginSkeleton() {
  return (
    <SkeletonContainer label="Sign in">
      <LoginCard>
        <LoginHeading title="Sign in to FaithForm" description="How would you like to sign in?" />
        <SignInChoice mode="password" />
        <div className="mt-6 space-y-5">
          <div>
            <p className="mb-2 text-base font-semibold">Email</p>
            <Skeleton className="h-12 w-full rounded-[10px]" />
          </div>
          <div>
            <p className="mb-2 text-base font-semibold">Password</p>
            <Skeleton className="h-12 w-full rounded-[10px]" />
            <p className="mt-2 text-sm text-muted-foreground">
              New to the team? Use the temporary password your church admin gave you.
            </p>
          </div>
          <Skeleton className="h-12 w-full rounded-[10px]" />
          <div className="h-11" />
        </div>
      </LoginCard>
    </SkeletonContainer>
  );
}
