import { redirect } from "next/navigation";

/**
 * Theme and colours now live on "Look & Details". Old links and bookmarks land
 * on that section.
 */
export default function WebsiteDesignRedirect() {
  redirect("/dashboard/website/details#look");
}
