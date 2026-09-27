/** Read a complete id-ordered PostgREST result despite the API's row cap. */
export async function readAllById<T extends { id: string }>(
  loadPage: (afterId: string | null, includeCount: boolean, pageSize: number) => Promise<{
    data: T[] | null;
    error: { message: string } | null;
    count?: number | null;
  }>,
  options: { label: string; maxRows?: number; pageSize?: number },
): Promise<T[]> {
  const maxRows = options.maxRows ?? 10_000;
  const pageSize = options.pageSize ?? 500;
  const rows: T[] = [];
  const seen = new Set<string>();
  let afterId: string | null = null;
  let expected: number | null = null;

  for (;;) {
    const page = await loadPage(afterId, expected === null, pageSize);
    if (page.error) throw new Error(`${options.label} read failed`);
    if (expected === null) {
      if (!Number.isSafeInteger(page.count) || (page.count ?? -1) < 0) {
        throw new Error(`${options.label} count unavailable`);
      }
      expected = page.count as number;
      if (expected > maxRows) throw new Error(`${options.label} exceeds ${maxRows} rows`);
    }

    const batch = page.data ?? [];
    if (batch.length > pageSize || (batch.length === 0 && rows.length < expected)) {
      throw new Error(`${options.label} incomplete`);
    }
    let previousId = afterId;
    for (const row of batch) {
      if (!row.id || seen.has(row.id) || (previousId !== null && row.id <= previousId)) {
        throw new Error(`${options.label} repeated or unordered row`);
      }
      seen.add(row.id);
      rows.push(row);
      previousId = row.id;
    }
    if (rows.length === expected) return rows;
    if (rows.length > expected) throw new Error(`${options.label} changed while loading`);
    afterId = batch.at(-1)?.id ?? null;
    if (!afterId) throw new Error(`${options.label} incomplete`);
  }
}
