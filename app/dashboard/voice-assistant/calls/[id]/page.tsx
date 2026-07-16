import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — call detail lives under /dashboard/call-log/[id]. */
export default function VoiceAssistantCallDetailRedirect({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/dashboard/call-log/${params.id}`);
}
