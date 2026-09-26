import { redirect } from "next/navigation";

import { CheckoutConsole } from "@/components/checkin/checkout-console";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  if (await pageFeatureBlocked("checkin")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  return <CheckoutConsole />;
}
