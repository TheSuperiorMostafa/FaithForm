import Link from "next/link";
import { Calendar, Mail } from "lucide-react";
import { OptionalNote } from "@/components/onboarding/steps/optional-note";
import { Button } from "@/components/ui/button";

function GoogleIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type StepGoogleProps = {
  connected: boolean;
  email: string | null;
  connectUrl: string;
  error: string | null;
  onSkip: () => void;
  onContinue: () => void;
};

export function StepGoogle({
  connected,
  email,
  connectUrl,
  error,
  onSkip,
  onContinue,
}: StepGoogleProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          Connect your Google account
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          If your church uses Google Calendar or Gmail, connecting lets
          FaithForm do this for you:
        </p>
      </div>

      <ul className="space-y-3 text-base text-foreground">
        <li className="flex items-start gap-3">
          <Calendar className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          Your church calendar&apos;s events show up in FaithForm, so you don&apos;t type them twice.
        </li>
        <li className="flex items-start gap-3">
          <Mail className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          Your weekly announcement email is written for you as a Gmail draft. You check it and send it.
        </li>
      </ul>

      <OptionalNote />

      {connected ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Google is connected
          </p>
          {email && (
            <p className="mt-1 text-sm text-muted-foreground">{email}</p>
          )}
          <Button type="button" size="lg" className="mt-4 h-12" onClick={onContinue}>
            Continue
          </Button>
        </div>
      ) : (
        <Link
          href={connectUrl}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-[10px] border-2 border-primary bg-card text-base font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <GoogleIcon />
          Connect Google
        </Link>
      )}

      {error && (
        <p className="text-base text-destructive" role="alert">
          {error}
        </p>
      )}

      {!connected && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        </div>
      )}
    </div>
  );
}
