/** Preserve message IDs across ambiguous network errors, so retries cannot duplicate a post. */
export async function deliverGroupAnnouncement(
  batchId: string,
  groupIds: string[],
  text: string,
  send: (groupId: string, message: { id: string; text: string }) => Promise<unknown>,
): Promise<{ sent: string[]; failed: string | null }> {
  const sent: string[] = [];
  for (const groupId of [...new Set(groupIds)]) {
    try {
      await send(groupId, { id: `${batchId}-${groupId}`, text });
      sent.push(groupId);
    } catch {
      return { sent, failed: groupId };
    }
  }
  return { sent, failed: null };
}
