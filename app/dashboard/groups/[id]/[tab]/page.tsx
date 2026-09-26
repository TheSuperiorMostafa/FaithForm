import { GroupPanel } from "../panels";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function GroupTabPage({ params }: { params: Promise<{ id: string; tab: string }> }) {
  if (await pageFeatureBlocked("groups")) return null;

  const { id, tab } = await params;
  return <GroupPanel id={id} tab={tab} />;
}
