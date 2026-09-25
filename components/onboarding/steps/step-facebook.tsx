import Link from "next/link";
import { Megaphone } from "lucide-react";
import { OptionalNote } from "@/components/onboarding/steps/optional-note";
import { Button } from "@/components/ui/button";

function FacebookIcon() {
  return (
    <svg className="size-5 fill-white" viewBox="0 0 24 24" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

type StepFacebookProps = {
  connected: boolean;
  pageName: string | null;
  connectUrl: string;
  error: string | null;
  onSkip: () => void;
  onContinue: () => void;
};

export function StepFacebook({
  connected,
  pageName,
  connectUrl,
  error,
  onSkip,
  onContinue,
}: StepFacebookProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          Connect your Facebook Page
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          If your church has a Facebook Page, connecting lets FaithForm post to
          it for you.
        </p>
      </div>

      <ul className="space-y-3 text-base text-foreground">
        <li className="flex items-start gap-3">
          <Megaphone className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          Share an announcement on your Facebook Page in one click. Nothing is
          posted unless you choose to post it.
        </li>
      </ul>

      <OptionalNote />

      {connected ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Facebook is connected
          </p>
          {pageName && (
            <p className="mt-1 text-sm text-muted-foreground">{pageName}</p>
          )}
          <Button type="button" size="lg" className="mt-4 h-12" onClick={onContinue}>
            Continue
          </Button>
        </div>
      ) : (
        <Link
          href={connectUrl}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-[10px] bg-[#1877F2] text-base font-semibold text-white transition-opacity hover:opacity-90"
        >
          <FacebookIcon />
          Connect Facebook
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
