"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

type StatSparklineProps = {
  data: number[];
  className?: string;
};

export function StatSparkline({ data, className }: StatSparklineProps) {
  const chartData = data.map((value, index) => ({ index, value }));

  return (
    <div className={className ?? "h-12 w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#sparkFill)"
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
