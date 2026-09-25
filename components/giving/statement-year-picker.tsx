import Link from "next/link";

import { statementYearOptions } from "@/lib/giving/statement-year";
import { cn } from "@/lib/utils";

/** The first choice on the statements page: which year they are for. */
export function StatementYearPicker({ year }: { year: number }) {
  return (
    <nav aria-label="Statement year" className="flex flex-col gap-3">
      <span className="text-lg font-semibold text-foreground">Which year?</span>
      <div className="flex flex-wrap gap-2">
        {statementYearOptions().map((option) => (
          <Link
            key={option}
            href={`/dashboard/giving/statements?year=${option}`}
            aria-current={option === year ? "page" : undefined}
            className={cn(
              "inline-flex min-h-12 items-center rounded-full border px-6 text-base font-semibold transition-colors",
              option === year
                ? "border-primary bg-primary text-primary-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground"
                : "border-border bg-card text-foreground hover:border-accent",
            )}
          >
            {option}
          </Link>
        ))}
      </div>
    </nav>
  );
}
