import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — call log lives under Voice Assistant. */
export default function CallLogRedirectPage() {
  redirect("/dashboard/voice-assistant/calls");
}
