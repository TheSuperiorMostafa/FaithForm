import { cn } from "@/lib/utils";

type OnboardingProgressProps = {
  step: number;
  total: number;
  labels: string[];
};

export function OnboardingProgress({
  step,
  total,
  labels,
}: OnboardingProgressProps) {
  const pct = (step / total) * 100;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">
          Step {step} of {total}
        </span>
        <span className="text-muted-foreground">{labels[step - 1]}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 hidden justify-between gap-1 sm:flex">
        {labels.map((label, i) => {
          const idx = i + 1;
          const active = idx === step;
          const done = idx < step;
          return (
            <span
              key={label}
              className={cn(
                "flex-1 truncate text-center text-[11px]",
                active && "font-semibold text-accent",
                done && "text-foreground",
                !active && !done && "text-muted-foreground",
              )}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
