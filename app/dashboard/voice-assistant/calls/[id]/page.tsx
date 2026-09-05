import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The call log moved out of Voice Assistant and became its own section. */
export default async function VoiceAssistantCallDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/call-log/${id}`);
}
