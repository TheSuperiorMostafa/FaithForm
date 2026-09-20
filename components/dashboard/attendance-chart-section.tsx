import { Users } from "lucide-react";
import { AttendanceAreaChart } from "@/components/dashboard/attendance-area-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getAttendanceTrend } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

type AttendanceChartSectionProps = {
  churchId: string;
};

function formatLastService(date: string | null) {
  if (!date) return null;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export async function AttendanceChartSection({
  churchId,
}: AttendanceChartSectionProps) {
  const supabase = createClient();
  const trend = await getAttendanceTrend(supabase, churchId);
  const lastLabel = formatLastService(trend.lastServiceDate);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Users className="size-7" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>Attendance trends</CardTitle>
            <CardDescription className="mt-1">
              {trend.lastPresent !== null && lastLabel ? (
                <>
                  {lastLabel}:{" "}
                  <span className="font-medium text-foreground">
                    {trend.lastPresent} present
                  </span>
                  {trend.vsFourWeekAvgPercent !== null && (
                    <span
                      className={cn(
                        "ml-2 font-medium",
                        trend.vsFourWeekAvgPercent >= 0
                          ? "text-green-700 dark:text-green-300"
                          : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {trend.vsFourWeekAvgPercent >= 0 ? "+" : ""}
                      {trend.vsFourWeekAvgPercent}% vs recent average
                    </span>
                  )}
                </>
              ) : (
                "Attendance from all service days appears here over the last 12 weeks."
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <AttendanceAreaChart points={trend.points} />
      </CardContent>
    </Card>
  );
}
