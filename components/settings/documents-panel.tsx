import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAttendanceReportMonths, getMonthlyReportMonths } from "@/lib/queries/library";
import { createClient } from "@/lib/supabase/server";
import { formatMonthLabel, monthSlug } from "@/lib/utils/reports";

export async function DocumentsPanel({ churchId, attendance, timeSaved }: {
  churchId: string; attendance: boolean; timeSaved: boolean;
}) {
  const client = createClient();
  const [months, summaries] = await Promise.all([
    attendance ? getAttendanceReportMonths(client, churchId) : Promise.resolve([]),
    timeSaved ? getMonthlyReportMonths(client, churchId) : Promise.resolve([]),
  ]);
  const quarters = [...new Set(months.map(m => `${m.year}-Q${Math.ceil(m.month / 3)}`))];
  const years = [...new Set(months.map(m => String(m.year)))];
  const groups = [
    { title: "Monthly", periods: months.map(m => ({ slug: monthSlug(m.year, m.month), label: formatMonthLabel(m.year, m.month) })) },
    { title: "Quarterly", periods: quarters.map(slug => ({ slug, label: `Quarter ${slug.slice(-1)}, ${slug.slice(0, 4)}` })) },
    { title: "Annual", periods: years.map(slug => ({ slug, label: slug })) },
  ];
  return <div className="flex flex-col gap-6">
    {attendance && <Card>
      <CardHeader><CardTitle>Attendance reports</CardTitle><CardDescription>Choose a period and download a PDF.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-6">
        {months.length === 0 ? <p className="text-muted-foreground">Reports appear after you record attendance.</p> : groups.map(group => <section key={group.title} className="space-y-3">
          <h3 className="font-semibold">{group.title}</h3>
          <div className="flex flex-wrap gap-3">{group.periods.map(period => <a key={period.slug} download href={`/api/reports/attendance/${period.slug}`} className={buttonVariants({ variant: "outline" })}>
            <Download className="size-4" aria-hidden />{period.label}<span className="sr-only"> attendance PDF</span>
          </a>)}</div>
        </section>)}
      </CardContent>
    </Card>}
    {timeSaved && <Card>
      <CardHeader><CardTitle>Time saved reports</CardTitle><CardDescription>Choose a period and download a PDF.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {summaries.length === 0 ? <p className="text-muted-foreground">Reports appear after FaithForm completes work for your church.</p> : summaries.map(m => <a key={monthSlug(m.year, m.month)} download href={`/api/reports/time-saved/${monthSlug(m.year, m.month)}`} className={buttonVariants({ variant: "outline" })}>
          <Download className="size-4" aria-hidden />{formatMonthLabel(m.year, m.month)}<span className="sr-only"> time saved PDF</span>
        </a>)}
      </CardContent>
    </Card>}
  </div>;
}
