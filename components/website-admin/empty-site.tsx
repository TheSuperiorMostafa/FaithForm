import { redirect } from "next/navigation";

import { SiteBuilder } from "@/components/website-admin/site-builder";
import { getChurchAuth } from "@/lib/auth/church";
import { buildSiteProfile, getSiteThemes } from "@/lib/sites/queries";

/**
 * Shown when the `website` feature is on but no site rows exist yet.
 *
 * This is the build screen, not a "contact us" dead end — a church can create
 * their own site from their Church Profile without waiting on anyone.
 */
export async function EmptySite() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [themes, profile] = await Promise.all([
    getSiteThemes(),
    buildSiteProfile(auth.churchId),
  ]);

  const readiness = [
    {
      label: "Church name and address",
      ready: Boolean(profile?.name && profile?.address),
      hint: profile?.address
        ? "used in the header, footer and map"
        : "add an address to show the map and directions",
    },
    {
      label: "Service times",
      ready: Boolean(profile?.serviceTimes.length),
      hint: profile?.serviceTimes.length
        ? `${profile.serviceTimes.length} on file — these become the times strip`
        : "without these the times strip stays hidden",
    },
    {
      label: "Staff",
      ready: Boolean(profile?.staff.length),
      hint: profile?.staff.length
        ? `${profile.staff.length} public — these become the team section`
        : "no public staff yet, so the team section starts hidden",
    },
    {
      label: "Mission and vision",
      ready: Boolean(profile?.missionStatement || profile?.visionStatement),
      hint:
        profile?.missionStatement || profile?.visionStatement
          ? "we'll shorten these for the website"
          : "without these the vision section stays hidden",
    },
    {
      label: "Online giving",
      ready: Boolean(profile?.givingEnabled),
      hint: profile?.givingEnabled
        ? "your giving page is connected"
        : "connect Stripe in Giving to switch the donate section on",
    },
  ];

  return (
    <SiteBuilder themes={themes} canBuild={auth.isAdmin} readiness={readiness} />
  );
}
