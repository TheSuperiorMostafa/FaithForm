import { CalendarCheck, Download, FileText } from "lucide-react";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import {
  getAttendanceReportMonths,
  getMonthlyReportMonths,
} from "@/lib/queries/library";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatMonthLabel, monthSlug } from "@/lib/utils/reports";

const REPORTS_TITLE = "Reports";
const REPORTS_DESCRIPTION = "Monthly attendance reports to download.";

/**
 * Reports (the route stays /dashboard/library so old links keep working).
 * Only the downloads live here; help and contact are in the top bar.
 */
function ReportRow({
  title,
  subtitle,
  downloadHref,
}: {
  title: string;
  subtitle: string;
  downloadHref: string;
}) {
  return (
    <li className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <FileText className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{title}</p>
          <p className="text-[15px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <a
        href={downloadHref}
        download
        className={cn(buttonVariants({ variant: "outline" }), "shrink-0 gap-2 self-start sm:self-center")}
      >
        <Download className="size-4" aria-hidden />
        Download PDF
      </a>
    </li>
  );
}

export default async function ReportsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const churchId = await getCurrentChurchId(supabase, user.id);

  if (!churchId) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title={REPORTS_TITLE} description={REPORTS_DESCRIPTION} />
        <EmptyState
          title="Your account isn't connected to a church yet"
          description="Ask your church admin for an invite. Once you're connected, your reports appear here."
        />
      </div>
    );
  }

  const [attendanceMonths, monthlyMonths] = await Promise.all([
    getAttendanceReportMonths(supabase, churchId),
    getMonthlyReportMonths(supabase, churchId),
  ]);

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={REPORTS_TITLE} description={REPORTS_DESCRIPTION} />

      <section className="flex flex-col gap-4" aria-labelledby="attendance-reports">
        <SectionHeader id="attendance-reports" title="Attendance" description="One report for each month you took attendance." />
        {attendanceMonths.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarCheck}
            title="No attendance reports yet"
            description="Your first report appears here at the end of the first month you take attendance."
          />
        ) : (
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {attendanceMonths.map((m) => {
              const slug = monthSlug(m.year, m.month);
              return (
                <ReportRow
                  key={`att-${slug}`}
                  title={`${formatMonthLabel(m.year, m.month)} attendance`}
                  subtitle={`${m.sundayCount} Sunday${m.sundayCount === 1 ? "" : "s"} · on average ${m.avgPresent} people`}
                  downloadHref={`/api/reports/attendance/${slug}`}
                />
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="monthly-summaries">
        <SectionHeader id="monthly-summaries" title="Monthly summary" description="What FaithForm did for your church each month." />
        {monthlyMonths.length === 0 ? (
          <EmptyState
            compact
            icon={FileText}
            title="No monthly summaries yet"
            description="Your first summary appears here at the end of your first full month."
          />
        ) : (
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {monthlyMonths.map((m) => {
              const slug = monthSlug(m.year, m.month);
              const hours = (m.totalMinutes / 60).toFixed(1);
              return (
                <ReportRow
                  key={`monthly-${slug}`}
                  title={`${formatMonthLabel(m.year, m.month)} summary`}
                  subtitle={`${hours} hours saved · ${m.tasks} task${m.tasks === 1 ? "" : "s"} · ${m.calls} call${m.calls === 1 ? "" : "s"}`}
                  downloadHref={`/api/reports/monthly/${slug}`}
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
