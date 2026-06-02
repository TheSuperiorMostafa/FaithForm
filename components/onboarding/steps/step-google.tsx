import Link from "next/link";
import { Calendar, Mail } from "lucide-react";
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
          Connect Google
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sync your church calendar and send Gmail drafts for announcements.
        </p>
      </div>

      <ul className="space-y-3 text-sm text-foreground">
        <li className="flex items-start gap-2">
          <Calendar className="mt-0.5 size-4 shrink-0 text-accent" />
          Pull events from Google Calendar automatically
        </li>
        <li className="flex items-start gap-2">
          <Mail className="mt-0.5 size-4 shrink-0 text-accent" />
          Create Gmail drafts for announcements in one click
        </li>
      </ul>

      {connected ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Google Connected ✓
          </p>
          {email && (
            <p className="mt-1 text-sm text-muted-foreground">{email}</p>
          )}
          <Button type="button" className="mt-4" onClick={onContinue}>
            Continue →
          </Button>
        </div>
      ) : (
        <Link
          href={connectUrl}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-[10px] border-2 border-primary bg-card text-[15px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <GoogleIcon />
          Connect Google Account
        </Link>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!connected && (
        <div className="text-right">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
}
