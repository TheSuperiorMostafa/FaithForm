"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTheme } from "@/components/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AttendanceChartProps = {
  data: Array<{ label: string; total: number }>;
};

const chartColors = {
  light: {
    grid: "var(--border)",
    tick: "#6B7280",
    tooltipBg: "#ffffff",
    tooltipBorder: "#DDD9D0",
    tooltipFg: "#002D5F",
    tooltipLabel: "#6B7280",
    line: "#002D5F",
  },
  dark: {
    grid: "rgba(255,255,255,0.08)",
    tick: "#9CA3AF",
    tooltipBg: "#0F2040",
    tooltipBorder: "rgba(255,255,255,0.08)",
    tooltipFg: "#F0EDE6",
    tooltipLabel: "#9CA3AF",
    line: "#C5A059",
  },
} as const;

export function AttendanceChart({ data }: AttendanceChartProps) {
  const { resolved } = useTheme();
  const colors = chartColors[resolved];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance Trend</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No attendance recorded yet
          </div>
        ) : (
          <div className="h-64 w-full" key={resolved}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.grid}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.tick, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: colors.tick, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    border: `1px solid ${colors.tooltipBorder}`,
                    borderRadius: "0.75rem",
                    color: colors.tooltipFg,
                    boxShadow: "0 2px 12px rgba(0,45,95,0.07)",
                    fontFamily: "var(--font-sans)",
                  }}
                  labelStyle={{ color: colors.tooltipLabel }}
                  formatter={(value) => [value, "Present"]}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke={colors.line}
                  strokeWidth={3}
                  dot={{ fill: colors.line, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
