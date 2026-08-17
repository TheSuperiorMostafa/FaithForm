import Link from "next/link";
import { Clock, Lock, ShieldOff, Sparkles, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { featureBlockReason, getFeatureAccess } from "@/lib/features/access";
import { getFeature, type FeatureKey } from "@/lib/features/catalog";
import {
  describeDisabledFeature,
  disabledFeatureAction,
  type DisabledReason,
} from "@/lib/features/disabled-reason";
import { cn } from "@/lib/utils";

type FeatureGateProps = {
  feature: FeatureKey;
  children: React.ReactNode;
};

/**
 * Each reason gets its own icon and accent.
 *
 * A pause and a permissions problem are different news, and colour is how
 * someone tells them apart before reading a word: amber for "wait", gold for
 * "on its way", muted for "not yours to open".
 */
const REASON_STYLE: Record<
  DisabledReason,
  { icon: LucideIcon; ring: string; badge: string; label: string }
> = {
  temporarily_unavailable: {
    icon: Clock,
    ring: "from-amber-400/25 to-amber-400/0",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    label: "Paused",
  },
  coming_soon: {
    icon: Sparkles,
    ring: "from-accent/30 to-accent/0",
    badge: "bg-accent/15 text-accent",
    label: "Coming soon",
  },
  not_in_plan: {
    icon: Lock,
    ring: "from-accent/25 to-accent/0",
    badge: "bg-muted text-muted-foreground",
    label: "Not enabled",
  },
  custom: {
    icon: Lock,
    ring: "from-accent/25 to-accent/0",
    badge: "bg-muted text-muted-foreground",
    label: "Unavailable",
  },
};

function LockedCard({
  icon: Icon,
  eyebrow,
  eyebrowClass,
  ring,
  title,
  message,
  action,
  secondary,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  eyebrowClass?: string;
  ring?: string;
  title: string;
  message: string;
  action: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-10 text-center sm:py-16">
      {/*
        The glow is what stops this reading as an error page. It is a soft halo
        behind the icon, not a border — the state is informational, and a hard
        dashed outline made every one of these look like something broke.
      */}
      <div className="relative mb-6 flex items-center justify-center">
        <span
          aria-hidden
          className={cn(
            "absolute size-32 rounded-full bg-gradient-to-b blur-xl",
            ring ?? "from-accent/25 to-accent/0",
          )}
        />
        <span className="relative flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-card">
          <Icon className="size-7 text-accent" strokeWidth={1.5} aria-hidden />
        </span>
      </div>

      {eyebrow && (
        <span
          className={cn(
            "mb-3 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
            eyebrowClass ?? "bg-muted text-muted-foreground",
          )}
        >
          {eyebrow}
        </span>
      )}

      <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">
        {title}
      </h2>
      <p className="mt-2.5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        {message}
      </p>

      <div className="mt-7 flex flex-col-reverse items-center gap-2 sm:flex-row sm:justify-center">
        {secondary && (
          <Link href={secondary.href}>
            <Button variant="ghost">{secondary.label}</Button>
          </Link>
        )}
        <Link href={action.href}>
          <Button>{action.label}</Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * Wraps a dashboard section so every nested route inherits the same check.
 * Drop it into the section's `layout.tsx` and nothing underneath can be
 * reached by URL once the feature is off for the account or the member.
 */
export async function FeatureGate({ feature, children }: FeatureGateProps) {
  const access = await getFeatureAccess();
  const definition = getFeature(feature);

  if (!access) {
    return (
      <LockedCard
        icon={ShieldOff}
        title="No church linked"
        message="Link your account to a church to open this section."
        action={{ href: "/dashboard", label: "Back to dashboard" }}
      />
    );
  }

  const reason = featureBlockReason(access, feature);

  if (reason === "account_disabled") {
    // What the church is told is chosen when the switch is thrown, so a feature
    // paused for a week doesn't read as a billing problem.
    const notice = access.notices[feature];
    const { title, message } = describeDisabledFeature(definition.label, notice);
    const style = REASON_STYLE[notice?.reason ?? "not_in_plan"];
    const primary = disabledFeatureAction(notice?.reason);

    return (
      <LockedCard
        icon={style.icon}
        eyebrow={style.label}
        eyebrowClass={style.badge}
        ring={style.ring}
        title={title}
        message={message}
        action={primary}
        secondary={
          primary.href === "/dashboard"
            ? undefined
            : { href: "/dashboard", label: "Back to dashboard" }
        }
      />
    );
  }

  if (reason === "no_permission") {
    return (
      <LockedCard
        icon={ShieldOff}
        eyebrow="No access"
        title={`You don't have access to ${definition.label}`}
        message={`A church admin can grant you ${definition.label} access from Settings → Team.`}
        action={{ href: "/dashboard", label: "Back to dashboard" }}
      />
    );
  }

  return <>{children}</>;
}
