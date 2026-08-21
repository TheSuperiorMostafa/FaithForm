import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — call detail lives under Voice Assistant. */
export default async function CallLogDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/voice-assistant/calls/${id}`);
}
