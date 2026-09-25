import { notFound, redirect } from "next/navigation";

/** Topic and speaker pages moved under Recordings; old links keep working. */
export default async function LegacyMediaTagPage({
  params,
}: {
  params: Promise<{ axis: string; value: string }>;
}) {
  const { axis, value } = await params;
  if (axis !== "topic" && axis !== "speaker") notFound();
  let label = value;
  try {
    label = decodeURIComponent(value);
  } catch {
    notFound();
  }
  redirect(`/dashboard/live-streaming/recordings/tag/${axis}/${encodeURIComponent(label)}`);
}
