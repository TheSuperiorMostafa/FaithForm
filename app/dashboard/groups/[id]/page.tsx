import { GroupPanel } from "./panels";

export const dynamic = "force-dynamic";

/** A group opens on its people: the list most visits are about. */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupPanel id={id} tab="members" />;
}
