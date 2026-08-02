import Link from "next/link";
import { Globe } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shown when the `website` feature is on but no site rows exist yet — a church
 * mid-onboarding. An error here would read as a fault; this reads as a stage.
 */
export function EmptySite() {
  return (
    <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center shadow-card">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Globe className="size-7" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">
          Your website isn&apos;t built yet
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          We build the first draft from your Church Profile, then hand it over
          here for you to edit. Keeping your profile up to date is the fastest
          way to get started.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/dashboard/church-profile">
          <Button variant="outline">Edit Church Profile</Button>
        </Link>
        <Link href="/dashboard/support">
          <Button>Ask us to build it</Button>
        </Link>
      </div>
    </div>
  );
}
