/** Roll back only the failed operation; preserve newer changes and other rows. */
export function rollbackInboxStatus<T extends { id: string; status: string }>(
  rows: T[], id: string, attempted: T["status"], previous: T["status"],
): T[] {
  return rows.map(row => row.id === id && row.status === attempted ? { ...row, status: previous } : row);
}

type DatedMessage = { id: string; createdAt: string; status: string };

function compareMessages(a: DatedMessage, b: DatedMessage): number {
  const milliseconds = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (milliseconds) return milliseconds;
  // PostgreSQL preserves microseconds; Date.parse alone would reorder ties.
  const micros = (date: string) => Number((date.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  return micros(b.createdAt) - micros(a.createdAt) || b.id.localeCompare(a.id);
}

/** Refresh recent rows while retaining older pages and any local status edit. */
export function mergeInboxMessages<T extends DatedMessage>(
  current: T[], incoming: T[], mode: "refresh" | "older",
  overrides: ReadonlyMap<string, T["status"]> = new Map(),
): T[] {
  const byId = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) {
    if (mode === "older" && byId.has(row.id)) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()].map(row => overrides.has(row.id) ? { ...row, status: overrides.get(row.id)! } : row).sort(compareMessages);
}

/** A non-overlapping new first page may leave a gap; fill it without dropping old rows. */
export function inboxRefreshNeedsCursorReset(current: DatedMessage[], incoming: DatedMessage[]): boolean {
  if (!current.length || !incoming.length) return false;
  const loaded = new Set(current.map(row => row.id));
  return incoming.every(row => !loaded.has(row.id));
}
