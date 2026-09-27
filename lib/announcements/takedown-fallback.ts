/**
 * Older church databases can lack optional announcement columns. A takedown
 * must keep its timestamp: without it, the Post again list cannot find the
 * announcement even though the UI reports success.
 */
const OPTIONAL_TAKEDOWN_COLUMNS = [
  "facebook_scheduled_publish_time",
  "unsubmitted_by",
] as const;

export function omitMissingOptionalTakedownColumn<T extends object>(
  patch: T,
  errorMessage: string,
): Partial<T> | null {
  const missing = OPTIONAL_TAKEDOWN_COLUMNS.find(
    (column) => errorMessage.includes(column) && column in patch,
  );
  if (!missing) return null;

  const retry = { ...patch } as Record<string, unknown>;
  delete retry[missing];
  return retry as Partial<T>;
}
