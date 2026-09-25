import Link from "next/link";
import { BookOpen, Megaphone, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { FeatureKey } from "@/lib/features/catalog";
import { cn } from "@/lib/utils";

type QuickActionsSectionProps = {
  churchId: string;
  allowedFeatures: FeatureKey[];
};

const actions = [
  {
    label: "Add announcement",
    description: "Email & social",
    href: "/dashboard/announcements",
    icon: Megaphone,
    feature: "announcements",
  },
  {
    label: "Track attendance",
    description: "Sunday roll",
    href: "/dashboard/attendance",
    icon: Users,
    feature: "attendance",
  },
  {
    label: "Create sermon",
    description: "Sermon builder",
    href: "/dashboard/sermon-builder",
    icon: BookOpen,
    feature: "sermon_builder",
  },
] as const satisfies ReadonlyArray<{ feature: FeatureKey } & Record<string, unknown>>;

/** Features that put at least one tile in this section. */
export const QUICK_ACTION_FEATURES: FeatureKey[] = actions.map((a) => a.feature);

export function hasQuickActions(allowedFeatures: FeatureKey[]): boolean {
  return QUICK_ACTION_FEATURES.some((key) => allowedFeatures.includes(key));
}

export function QuickActionsSection({
  churchId: _churchId,
  allowedFeatures,
}: QuickActionsSectionProps) {
  const visibleActions = actions.filter((action) =>
    allowedFeatures.includes(action.feature),
  );

  if (visibleActions.length === 0) return null;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6",
        visibleActions.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3",
      )}
    >
      {visibleActions.map((action) => {
        const Icon = action.icon;
        return (
          <Link key={action.label} href={action.href} className="group">
            <Card
              className={cn(
                "flex min-h-[148px] flex-col items-center justify-center gap-4 border-border/80 p-7 text-center transition-all sm:min-h-[160px] sm:p-8",
                "hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card-hover",
              )}
            >
              <div className="flex size-14 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors group-hover:bg-accent/20 sm:size-16">
                <Icon className="size-7 sm:size-8" strokeWidth={1.75} aria-hidden />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground sm:text-lg">
                  {action.label}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {action.description}
                </p>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
