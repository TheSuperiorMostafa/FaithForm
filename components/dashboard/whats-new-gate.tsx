import { WhatsNewDialog } from "@/components/dashboard/whats-new-dialog";
import { getPendingWhatsNew } from "@/lib/releases/whats-new-server";

/**
 * Streams in after the dashboard has painted (it sits in its own Suspense
 * boundary with no fallback), so a slow read never delays the page and a
 * modal needs no placeholder. Renders nothing when there is nothing new.
 */
export async function WhatsNewGate() {
  const release = await getPendingWhatsNew();
  return release ? <WhatsNewDialog key={release.releaseId} release={release} /> : null;
}
