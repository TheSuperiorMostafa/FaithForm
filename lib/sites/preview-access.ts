import type { ChurchAuth } from "@/lib/auth/church";

/** A draft website is visible only inside its own church's website workspace. */
export function canPreviewDraftSite(
  churchId: string,
  viewer: Pick<ChurchAuth, "churchId" | "isAdmin" | "featurePermissions"> | null,
): boolean {
  return Boolean(
    viewer?.churchId === churchId &&
      (viewer.isAdmin || viewer.featurePermissions.includes("website")),
  );
}
