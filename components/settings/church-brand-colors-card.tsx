import { BrandColorsCard } from "@/components/settings/brand-colors-card";
import { ErrorState } from "@/components/ui/error-state";
import { createClient } from "@/lib/supabase/server";

/** Rendered only inside an authenticated church admin page. */
export async function ChurchBrandColorsCard({ churchId, appEnabled }: { churchId: string; appEnabled: boolean }) {
  const { data, error } = await createClient()
    .from("churches")
    .select("giving_primary_color, giving_accent_color")
    .eq("id", churchId)
    .maybeSingle();

  if (error || !data) {
    return <ErrorState compact title="Your colors didn't load" description="Nothing was changed. Refresh the page to try again." />;
  }
  return (
    <BrandColorsCard
      primaryColor={data.giving_primary_color ?? null}
      accentColor={data.giving_accent_color ?? null}
      appEnabled={appEnabled}
    />
  );
}
