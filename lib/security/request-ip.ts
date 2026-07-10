import { headers } from "next/headers";

export function getRequestIpFromHeaders(): string {
  const headersList = headers();
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headersList.get("x-real-ip")?.trim() || "unknown";
}
