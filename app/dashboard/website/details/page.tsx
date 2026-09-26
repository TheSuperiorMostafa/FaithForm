import { redirect } from "next/navigation";

import type { SiteDetailsInput } from "@/app/dashboard/website/actions";
import { DetailsForm } from "@/components/website-admin/details-form";
import { EmptySite } from "@/components/website-admin/empty-site";
import { getChurchAuth } from "@/lib/auth/church";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { getChurchProfile, profileToFormState } from "@/lib/queries/church-profile";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { getSiteThemes, getWebsiteForChurch } from "@/lib/sites/queries";
import { createAdminClient, createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Custom CSS is raw stylesheet text, so the field only appears for platform
 * admins. Church admins get the structured colour controls instead.
 */
async function isPlatformAdmin(): Promise<boolean> {
  const {
    data: { user },
  } = await createClient().auth.getUser();

  if (!user) return false;
  if (isBootstrapSuperAdminEmail(user.email)) return true;

  const admin = createAdminClientOrNull();
  if (!admin) return false;

  const { data } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return Boolean(data?.user_id);
}

/**
 * Website → Look & Details: the church facts the site shows (shared with the
 * app and the phone assistant), then the theme and colours. Formerly two tabs,
 * "Details" and "Design"; /design now redirects to the #look section here.
 */
export default async function WebsiteDetailsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const [profile, themes, platformAdmin] = await Promise.all([
    getChurchProfile(auth.churchId, createAdminClient()),
    getSiteThemes(),
    isPlatformAdmin(),
  ]);
  if (!profile) return <EmptySite />;

  const form = profileToFormState(profile);

  // Only the fields the website actually renders. The rest of the profile —
  // office hours, AI knowledge, socials — is preserved untouched when this
  // form saves.
  const initial: SiteDetailsInput = {
    name: form.name,
    denomination: form.denomination,
    logoUrl: form.logoUrl,
    coverImageUrl: form.coverImageUrl,
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
      isLive={site.page.status === "published"}
      design={{
        themes,
        initialThemeKey: site.settings?.themeKey ?? site.theme.key,
        initialTokens: site.settings?.brandTokens ?? {},
        initialCustomCss: site.settings?.customCss ?? "",
        themeDefaults: site.theme.tokens,
        isPlatformAdmin: platformAdmin,
      }}
    />
  );
}
