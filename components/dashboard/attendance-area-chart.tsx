"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AttendanceWeekPoint } from "@/lib/queries/dashboard";

type AttendanceAreaChartProps = {
  points: AttendanceWeekPoint[];
};

export function AttendanceAreaChart({ points }: AttendanceAreaChartProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Log attendance to see trends here.
      </div>
    );
  }

  return (
    <div className="h-52 w-full md:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--border)"
          />
          <XAxis
            dataKey="weekLabel"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              boxShadow: "0 2px 12px rgba(0,45,95,0.07)",
              color: "var(--card-foreground)",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
            }}
            labelFormatter={(_, payload) => {
              const p = payload?.[0]?.payload as AttendanceWeekPoint | undefined;
              return p?.serviceDate
                ? new Date(p.serviceDate).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                : "";
            }}
            formatter={(value) => [
              `${value ?? 0} present`,
              "Attendance",
            ]}
          />
          <Area
            type="monotone"
            dataKey="present"
            stroke="var(--primary)"
            strokeWidth={3}
            fill="url(#attendanceFill)"
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
