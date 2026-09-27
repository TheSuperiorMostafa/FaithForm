import type { ChurchAuth } from "@/lib/auth/church";

/** Both publication records must agree before anonymous visitors can see a site. */
export function isPublicSitePublication(
  pageStatus: string,
  settingsPublished: boolean | null | undefined,
): boolean {
  return pageStatus === "published" && settingsPublished === true;
}

/** A draft or otherwise offline website is visible only to its own website staff. */
export function canPreviewDraftSite(
  churchId: string,
  viewer: Pick<ChurchAuth, "churchId" | "isAdmin" | "featurePermissions"> | null,
): boolean {
  return Boolean(
    viewer?.churchId === churchId &&
      (viewer.isAdmin || viewer.featurePermissions.includes("website")),
  );
}
