import { featureBlockReason, getFeatureAccess } from "@/lib/features/access";
import type { FeatureKey } from "@/lib/features/catalog";

/**
 * For a page under a `<FeatureGate>` layout: true when the gate is showing its
 * locked card, so the page must stop before it reads anything.
 *
 * A layout and its page render side by side. The gate replaces what is drawn,
 * but the page still ran and its data still went to the browser inside the
 * page payload — a teammate without People was sent every member's phone and
 * email, and one without Phone Calls a call's transcript, behind a screen that
 * said they had no access. Answered from the same per-request access the gate
 * uses, so it costs nothing.
 */
export async function pageFeatureBlocked(feature: FeatureKey): Promise<boolean> {
  const access = await getFeatureAccess();
  return !access || featureBlockReason(access, feature) !== null;
}
