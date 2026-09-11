import { redirect } from "next/navigation";

/** Households moved under People. Old links and bookmarks still land. */
export default function CheckinHouseholdsMoved() {
  redirect("/dashboard/people/households");
}
