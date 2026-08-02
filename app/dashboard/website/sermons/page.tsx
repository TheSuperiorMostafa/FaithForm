import { redirect } from "next/navigation";

import { EmptySite } from "@/components/website-admin/empty-site";
import { MediaTable } from "@/components/website-admin/media-table";
import { getChurchAuth } from "@/lib/auth/church";
import { getSiteMediaForChurch, getWebsiteForChurch } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

export default async function WebsiteSermonsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const items = await getSiteMediaForChurch(auth.churchId);

  return <MediaTable items={items} canEdit={auth.isAdmin} />;
}
