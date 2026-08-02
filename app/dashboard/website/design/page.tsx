import { redirect } from "next/navigation";

import { DesignForm } from "@/components/website-admin/design-form";
import { EmptySite } from "@/components/website-admin/empty-site";
import { getChurchAuth } from "@/lib/auth/church";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { getSiteThemes, getWebsiteForChurch } from "@/lib/sites/queries";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

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

export default async function WebsiteDesignPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const [themes, platformAdmin] = await Promise.all([
    getSiteThemes(),
    isPlatformAdmin(),
  ]);

  return (
    <DesignForm
      themes={themes}
      initialThemeKey={site.settings?.themeKey ?? site.theme.key}
      initialTokens={site.settings?.brandTokens ?? {}}
      initialCustomCss={site.settings?.customCss ?? ""}
      themeDefaults={site.theme.tokens}
      canEdit={auth.isAdmin}
      isPlatformAdmin={platformAdmin}
    />
  );
}
