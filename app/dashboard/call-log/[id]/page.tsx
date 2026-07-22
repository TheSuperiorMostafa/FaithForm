import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — call detail lives under Voice Assistant. */
export default function CallLogDetailRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/dashboard/voice-assistant/calls/${params.id}`);
}
