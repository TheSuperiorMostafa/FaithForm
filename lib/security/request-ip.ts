import { headers } from "next/headers";
import { getClientIp } from "@/lib/security/rate-limit";

export async function getRequestIpFromHeaders(): Promise<string> {
  const headersList = await headers();
  return getClientIp(new Request("http://internal", { headers: headersList }));
}
