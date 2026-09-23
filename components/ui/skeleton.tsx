import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] motion-reduce:before:animate-none before:bg-gradient-to-r before:from-transparent before:via-white/45 before:to-transparent dark:before:via-white/10",
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonContainerProps extends React.ComponentProps<"div"> {
  label?: string;
  delay?: boolean;
}

/**
 * Standardized skeleton container enforcing accessibility (role="status",
 * aria-busy="true") and the 180ms anti-flicker delay to prevent visual stutter
 * on instantaneous/cached navigations.
 */
function SkeletonContainer({
  children,
  className,
  label = "content",
  delay = true,
  ...props
}: SkeletonContainerProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Loading ${label}`}
      className={cn(
        "w-full",
        delay && "animate-skeleton-fade motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      {children}
      <span className="sr-only">Loading {label}…</span>
    </div>
  );
}

export interface SkeletonTextProps extends React.ComponentProps<"div"> {
  lines?: number;
  lastLineWidth?: string;
  size?: "sm" | "base" | "lg";
}

/**
 * Realistic typographic skeleton mimicking natural paragraph sentence flow
 * (staggered line lengths and font leading metric parity) to prevent baseline layout shifts.
 */
function SkeletonText({
  lines = 3,
  lastLineWidth = "w-3/5",
  size = "base",
  className,
  ...props
}: SkeletonTextProps) {
  const heightClass =
    size === "sm" ? "h-3.5" : size === "lg" ? "h-5" : "h-4";
  const gapClass =
    size === "sm" ? "space-y-1.5" : size === "lg" ? "space-y-2.5" : "space-y-2";

  return (
    <div className={cn(gapClass, className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => {
        const isLast = i === lines - 1;
        const isMiddle = i > 0 && !isLast && i % 2 === 1;
        const widthClass = isLast
          ? lastLineWidth
          : isMiddle
            ? "w-[92%]"
            : "w-full";

        return (
          <Skeleton
            key={i}
            className={cn(heightClass, widthClass)}
          />
        );
      })}
    </div>
  );
}

export { Skeleton, SkeletonContainer, SkeletonText };
