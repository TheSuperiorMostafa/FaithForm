import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

type StatCardProps = {
  label: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
};

export function StatCard({ label, value, description, icon: Icon }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden border-t-[3px] border-t-accent p-6">
      <div className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="size-7" strokeWidth={1.75} />
      </div>
      <p className="pr-12 text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-4xl font-bold tracking-tight text-foreground dark:text-accent">
        {value}
      </p>
      {description && (
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      )}
    </Card>
  );
}
