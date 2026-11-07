import { redirect } from "next/navigation";

// Open the corresponding editor without duplicating its save and preview logic.
export default function ChurchAppSectionPage() {
  redirect("/dashboard/app#church-about");
}
