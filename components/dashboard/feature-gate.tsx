import Link from "next/link";
import { Lock, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { featureBlockReason, getFeatureAccess } from "@/lib/features/access";
import { getFeature, type FeatureKey } from "@/lib/features/catalog";

type FeatureGateProps = {
  feature: FeatureKey;
  children: React.ReactNode;
};

function LockedCard({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: typeof Lock;
  title: string;
  message: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center shadow-card">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="size-7" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">
          {title}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
      <Link href={action.href}>
        <Button variant="outline">{action.label}</Button>
      </Link>
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
    return (
      <LockedCard
        icon={Lock}
        title={`${definition.label} isn't enabled`}
        message={`${definition.label} isn't part of your church's FaithForm plan yet. Reach out and we'll turn it on for you.`}
        action={{ href: "/dashboard/support", label: "Contact support" }}
      />
    );
  }

  if (reason === "no_permission") {
    return (
      <LockedCard
        icon={ShieldOff}
        title={`You don't have access to ${definition.label}`}
        message={`A church admin can grant you ${definition.label} access from Settings → Team.`}
        action={{ href: "/dashboard", label: "Back to dashboard" }}
      />
    );
  }

  return <>{children}</>;
}
