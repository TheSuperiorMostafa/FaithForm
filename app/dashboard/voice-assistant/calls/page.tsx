import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The call log moved out of Voice Assistant and became its own section. */
export default function VoiceAssistantCallsRedirectPage() {
  redirect("/dashboard/call-log");
}
