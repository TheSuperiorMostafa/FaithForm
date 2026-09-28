/** Read every provider page before showing a calendar as complete. */
export async function collectCalendarPages<T>(
  fetchPage: (pageToken?: string) => Promise<{
    items?: T[] | null;
    nextPageToken?: string | null;
  }>,
): Promise<T[]> {
  const items: T[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;

  do {
    const page = await fetchPage(pageToken);
    items.push(...(page.items ?? []));
    const nextToken = page.nextPageToken || undefined;
    if (!nextToken) return items;
    if (seenTokens.has(nextToken)) {
      throw new Error("Calendar provider returned a repeated page token");
    }
    seenTokens.add(nextToken);
    pageToken = nextToken;
  } while (pageToken);

  return items;
}
