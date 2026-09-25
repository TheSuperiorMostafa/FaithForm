"use client";

import Link from "next/link";
import { CheckCircle2, CircleDashed, Play, Share2, TriangleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { SyndicationStatus } from "@/lib/stream/syndication";
import { cn } from "@/lib/utils";

export type PlatformPushState = {
  connected: boolean;
  detail: string | null;
  /** True once a destination is ready for the current service. */
  destinationReady: boolean;
  lastPush: SyndicationStatus | null;
  /** Set when a stored connection went stale and needs re-authorization. */
  needsReconnect?: boolean;
  reconnectReason?: string | null;
};

type PlatformsCardProps = {
  isAdmin: boolean;
  youtube: PlatformPushState;
  facebook: PlatformPushState;
  /** "compact" is the Setup step 3 list; "full" adds how the last service went. */
  variant?: "compact" | "full";
};

/** All connect and disconnect flows live in Settings › Connected accounts. */
export const CONNECTED_ACCOUNTS_HREF = "/dashboard/settings?tab=accounts";

/**
 * YouTube and Facebook, in plain words: connected or not, and whether the
 * last service actually reached them. The platforms' own error text is never
 * shown; it is written for developers.
 */
export function PlatformsCard({ isAdmin, youtube, facebook, variant = "full" }: PlatformsCardProps) {
  return (
    <ul className="flex flex-col gap-3">
      <PlatformRow
        icon={<Play className="size-5 text-red-500" aria-hidden />}
        name="YouTube"
        state={youtube}
        isAdmin={isAdmin}
        showPush={variant === "full"}
      />
      <PlatformRow
        icon={<Share2 className="size-5 text-blue-500" aria-hidden />}
        name="Facebook"
        state={facebook}
        isAdmin={isAdmin}
        showPush={variant === "full"}
      />
    </ul>
  );
}

function PushStatus({ name, state }: { name: string; state: PlatformPushState }) {
  if (state.lastPush?.status === "failed") {
    return (
      <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>
          Your last service didn&apos;t reach {name}. If it happens again, reconnect {name} in Settings.
        </span>
      </p>
    );
  }
  if (state.lastPush?.status === "success") {
    return (
      <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
        {state.destinationReady ? `Your video is reaching ${name}.` : `Your last service reached ${name}.`}
      </p>
    );
  }
  if (state.destinationReady) {
    return <p className="mt-1 text-sm text-muted-foreground">Waiting for {name} to start showing your video…</p>;
  }
  return null;
}

function PlatformRow({
  icon,
  name,
  state,
  isAdmin,
  showPush,
}: {
  icon: React.ReactNode;
  name: string;
  state: PlatformPushState;
  isAdmin: boolean;
  showPush: boolean;
}) {
  return (
    <li className="flex min-h-[72px] flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0">
          <p className="text-base font-semibold">{name}</p>
          {state.connected ? (
            <>
              <p className="mt-0.5 flex items-center gap-1.5 text-[15px] text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" aria-hidden />
                Connected{state.detail ? ` · ${state.detail}` : ""}. Your services show here too.
              </p>
              {showPush ? <PushStatus name={name} state={state} /> : null}
            </>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 text-[15px] text-muted-foreground">
              <CircleDashed className="size-4" aria-hidden />
              {state.needsReconnect ? `${name} needs to be reconnected` : "Not connected"}
            </p>
          )}
        </div>
      </div>

      {isAdmin && !state.connected ? (
        <Link href={CONNECTED_ACCOUNTS_HREF} className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          {state.needsReconnect ? `Reconnect ${name}` : `Connect ${name}`}
        </Link>
      ) : null}
    </li>
  );
}
