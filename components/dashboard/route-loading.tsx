import { DashboardPageSkeleton } from "@/components/dashboard/skeletons";

/**
 * The shared dashboard shell stays mounted while this route-level fallback is
 * streamed. Its stable block sizes mirror the common page shape to avoid a
 * blank wait or a large layout shift as primary content arrives.
 */
export function DashboardRouteLoading() {
  return <DashboardPageSkeleton />;
}

