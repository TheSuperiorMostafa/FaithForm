type StatSparklineProps = {
  data: number[];
  className?: string;
};

export function StatSparkline({ data, className }: StatSparklineProps) {
  const values = data.length > 0 ? data : [0];
  const width = 100;
  const height = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const denominator = Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: (index / denominator) * width,
    y: 3 + ((max - value) / span) * (height - 7),
  }));
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const area = `M ${points.map(({ x, y }) => `${x} ${y}`).join(" L ")} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className={className ?? "h-12 w-full"}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="size-full"
        aria-hidden
      >
        <path d={area} fill="var(--accent)" fillOpacity="0.13" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
