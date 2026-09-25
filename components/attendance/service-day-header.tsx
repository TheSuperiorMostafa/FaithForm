import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";

/**
 * The top of one Sunday: a way back to the list, the day as the title, one
 * plain sentence, and the page's one main action. Shared by counting a Sunday,
 * the saved summary and their loading state, so switching between them never
 * moves the page.
 */
export function ServiceDayHeader({
  title,
  description,
  action,
  secondary,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/dashboard/attendance"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg text-base font-semibold text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
        Back to Sunday count
      </Link>
      <PageHeader title={title} description={description} action={action} secondary={secondary} />
    </div>
  );
}
