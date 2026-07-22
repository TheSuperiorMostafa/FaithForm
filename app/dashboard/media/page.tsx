import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — media lives under Live Stream. */
export default function MediaRedirectPage() {
  redirect("/dashboard/live-streaming/media");
}
