import { redirect } from "next/navigation";

import type { SiteDetailsInput } from "@/app/dashboard/website/actions";
import { DetailsForm } from "@/components/website-admin/details-form";
import { EmptySite } from "@/components/website-admin/empty-site";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchProfile, profileToFormState } from "@/lib/queries/church-profile";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { getWebsiteForChurch } from "@/lib/sites/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function WebsiteDetailsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const profile = await getChurchProfile(auth.churchId, createAdminClient());
  if (!profile) return <EmptySite />;

  const form = profileToFormState(profile);

  // Only the fields the website actually renders. The rest of the profile —
  // office hours, AI knowledge, socials — stays on the Church Profile page and
  // is preserved untouched when this form saves.
  const initial: SiteDetailsInput = {
    name: form.name,
    denomination: form.denomination,
    logoUrl: form.logoUrl,
    address: form.address,
    city: form.city,
    state: form.state,
    zip: form.zip,
    phone: form.phone,
    email: form.email,
    googleMapsUrl: form.googleMapsUrl,
    missionStatement: form.missionStatement,
    visionStatement: form.visionStatement,
    serviceTimes: form.serviceTimes.map((row) => ({
      clientId: row.clientId,
      id: row.id,
      label: row.label,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime.slice(0, 5),
    })),
    staff: form.staff.map((row) => ({
      clientId: row.clientId,
      id: row.id,
      fullName: row.fullName,
      title: row.title,
      bio: row.bio,
      photoUrl: row.photoUrl,
      isPublic: row.isPublic,
    })),
  };

  return (
    <DetailsForm
      initial={initial}
      canEdit={auth.isAdmin}
      previewUrl={`${getCanonicalSiteUrl()}/sites/${site.slug}?preview=1`}
    />
  );
}
