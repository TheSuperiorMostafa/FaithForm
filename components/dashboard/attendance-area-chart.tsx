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

  const width = 720;
  const height = 224;
  const padding = { top: 12, right: 14, bottom: 34, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const rawMax = Math.max(...points.map((point) => point.present), 1);
  const yMax = Math.max(4, Math.ceil(rawMax / 5) * 5);
  const denominator = Math.max(1, points.length - 1);
  const plotted = points.map((point, index) => ({
    ...point,
    x: padding.left + (index / denominator) * plotWidth,
    y: padding.top + (1 - point.present / yMax) * plotHeight,
  }));
  const linePath = plotted
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const areaPath = `${linePath} L ${plotted.at(-1)!.x} ${padding.top + plotHeight} L ${plotted[0]!.x} ${padding.top + plotHeight} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) =>
    Math.round((yMax * index) / 4),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-52 w-full md:h-56"
      role="img"
      aria-labelledby="attendance-chart-title attendance-chart-description"
    >
      <title id="attendance-chart-title">Weekly attendance trend</title>
      <desc id="attendance-chart-description">
        {points
          .map((point) => `${point.weekLabel}: ${point.present} present`)
          .join(", ")}
      </desc>

      {ticks.map((value) => {
        const y = padding.top + (1 - value / yMax) * plotHeight;
        return (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 9}
              y={y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {value}
            </text>
          </g>
        );
      })}

      <path d={areaPath} fill="var(--accent)" fillOpacity="0.14" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {plotted.map((point, index) => {
        const showLabel =
          points.length <= 8 ||
          index === 0 ||
          index === points.length - 1 ||
          index % 2 === 0;
        return (
          <g key={`${point.serviceDate}-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r="4"
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth="2"
            >
              <title>
                {new Date(`${point.serviceDate}T12:00:00`).toLocaleDateString(
                  "en-US",
                  { weekday: "short", month: "short", day: "numeric" },
                )}
                {`: ${point.present} present`}
              </title>
            </circle>
            {showLabel && (
              <text
                x={point.x}
                y={height - 10}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {point.weekLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
