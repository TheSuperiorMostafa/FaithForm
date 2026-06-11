import { Download, Mail, MessageSquare, Video, type LucideIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import {
  getAttendanceReportMonths,
  getCurrentChurchId,
  getMonthlyReportMonths,
} from "@/lib/queries/library";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatMonthLabel, monthSlug } from "@/lib/utils/reports";

function ReportCard({
  title,
  subtitle,
  downloadHref,
}: {
  title: string;
  subtitle: string;
  downloadHref: string;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:border-accent/45 hover:shadow-card-hover dark:shadow-none md:flex-row md:items-center md:justify-between md:p-6">
      <div className="min-w-0 flex-1">
        <h3 className="font-heading text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <a
        href={downloadHref}
        download
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "inline-flex shrink-0 items-center gap-2 self-start md:self-center",
        )}
      >
        <Download className="size-4" aria-hidden />
        Download PDF
      </a>
    </article>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground md:col-span-2">
      {message}
    </div>
  );
}

function SupportCard({
  title,
  children,
  href,
  icon: Icon,
  dashed,
}: {
  title: string;
  children: React.ReactNode;
  href?: string;
  icon: LucideIcon;
  dashed?: boolean;
}) {
  const inner = (
    <>
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="size-7" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading text-lg font-semibold text-foreground">{title}</h3>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </>
  );

  const className = cn(
    "flex gap-4 rounded-xl border bg-card p-5 shadow-card dark:shadow-none md:p-6",
    dashed ? "border-dashed border-border/80" : "border-border",
  );

  if (href) {
    return (
      <a href={href} className={cn(className, "transition-all hover:border-accent/45 hover:bg-accent/5 hover:shadow-card-hover")}>
        {inner}
      </a>
    );
  }

  return <article className={className}>{inner}</article>;
}

export default async function LibraryPage() {
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
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          No church linked yet
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Your account is not linked to a church yet. Contact support to connect
          your church before using the library.
        </p>
      </div>
    );
  }

  const [attendanceMonths, monthlyMonths] = await Promise.all([
    getAttendanceReportMonths(supabase, churchId),
    getMonthlyReportMonths(supabase, churchId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download monthly reports for your records.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-xl font-semibold text-foreground">
          Attendance Reports
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {attendanceMonths.length === 0 ? (
            <EmptyCard message="No reports yet — your first month will appear here once you start logging attendance." />
          ) : (
            attendanceMonths.map((m) => {
              const label = formatMonthLabel(m.year, m.month);
              const slug = monthSlug(m.year, m.month);
              return (
                <ReportCard
                  key={`att-${slug}`}
                  title={`${label} — Attendance Report`}
                  subtitle={`${m.sundayCount} Sunday${m.sundayCount === 1 ? "" : "s"} · avg ${m.avgPresent} present`}
                  downloadHref={`/api/reports/attendance/${slug}`}
                />
              );
            })
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-xl font-semibold text-foreground">
          Monthly Reports
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {monthlyMonths.length === 0 ? (
            <EmptyCard message="No reports yet — your first month will appear here once automations start running." />
          ) : (
            monthlyMonths.map((m) => {
              const label = formatMonthLabel(m.year, m.month);
              const slug = monthSlug(m.year, m.month);
              const hours = (m.totalMinutes / 60).toFixed(1);
              return (
                <ReportCard
                  key={`monthly-${slug}`}
                  title={`${label} — Monthly Report`}
                  subtitle={`${hours} hrs saved · ${m.tasks} task${m.tasks === 1 ? "" : "s"} · ${m.calls} call${m.calls === 1 ? "" : "s"}`}
                  downloadHref={`/api/reports/monthly/${slug}`}
                />
              );
            })
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-xl font-semibold text-foreground">Support</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SupportCard
            title="Your Requests"
            href="mailto:faithform.io@gmail.com?subject=Feature%20Request%20or%20Bug%20Report"
            icon={MessageSquare}
          >
            Send feedback or report an issue
          </SupportCard>

          <SupportCard
            title="Contact Us"
            href="mailto:faithform.io@gmail.com"
            icon={Mail}
          >
            <span className="font-semibold text-primary">faithform.io@gmail.com</span>
          </SupportCard>

          <SupportCard title="How Your Systems Work" icon={Video} dashed>
            <p>Walkthrough video coming soon</p>
            <div
              className="mt-4 flex aspect-video w-full items-center justify-center rounded-xl bg-accent/10 text-xs font-semibold text-muted-foreground"
              aria-hidden
            >
              Video embed placeholder
            </div>
          </SupportCard>
        </div>
      </section>
    </div>
  );
}
