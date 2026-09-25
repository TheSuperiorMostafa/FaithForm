import { GroupPanel } from "../panels";

export const dynamic = "force-dynamic";

export default async function GroupTabPage({ params }: { params: Promise<{ id: string; tab: string }> }) {
  const { id, tab } = await params;
  return <GroupPanel id={id} tab={tab} />;
}
