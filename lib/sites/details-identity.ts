import { createHash } from "node:crypto";

/** The form's clientId survives pending/failed requests. Derive an insert ID
 * scoped to its church and table so retrying never recreates a staff/service
 * row or resets the assistant-only facts on that row. */
export function siteDetailsRowId(churchId: string, table: "staff" | "serviceTimes", row: { id?: string; clientId: string }): string {
  if (row.id) return row.id;
  const hex = createHash("sha256").update(JSON.stringify([churchId, table, row.clientId])).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
