import { GivingSettingsSkeleton } from "@/components/giving/skeletons";
import { getFeatureAccess } from "@/lib/features/access";

export default async function GivingSettingsLoading() {
  const access = await getFeatureAccess();
  return <GivingSettingsSkeleton appEnabled={Boolean(access?.flags.member_app)} />;
}
