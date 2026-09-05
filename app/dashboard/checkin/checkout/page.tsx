import { redirect } from "next/navigation";

import { CheckoutConsole } from "@/components/checkin/checkout-console";
import { getChurchAuth } from "@/lib/auth/church";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  return <CheckoutConsole />;
}
