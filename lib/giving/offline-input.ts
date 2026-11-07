import { z } from "zod";

export const offlineGiftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Choose a real date."),
  amount: z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, "Use dollars with up to two decimal places.")
    .refine(value => Number(value) > 0, "Enter an amount greater than zero."),
  fundId: z.string().uuid(),
  donorName: z.string().trim().max(200).default(""),
  donorEmail: z.union([z.literal(""), z.email()]).default(""),
  donorId: z.union([z.literal(""), z.string().uuid()]).default(""),
  method: z.enum(["cash", "check", "other"]).default("cash"),
  giftType: z.enum(["one_time", "recurring"]).default("one_time"),
});
export type OfflineGiftInput = z.input<typeof offlineGiftSchema>;
export function amountToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** RFC 4180 fields, including quoted commas/newlines and escaped quotes. */
export function parseDonationCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else throw new Error("A quote is in the wrong place in the spreadsheet.");
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("A quoted spreadsheet cell is not closed.");
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function donationRowsFromSheet(rows: string[][], funds: {id: string; name: string}[]): OfflineGiftInput[] {
  if (rows.length < 2 || rows.length > 501) throw new Error("Choose a sheet with 1 to 500 donations.");
  const headers = rows[0].map(value => value.trim().toLowerCase());
  for (const header of ["date", "amount", "fund"]) if (!headers.includes(header)) throw new Error(`The sheet needs a ${header} column.`);
  return rows.slice(1).map((row, index) => {
    const get = (header: string) => row[headers.indexOf(header)]?.trim() ?? "";
    const matching = funds.filter(fund => fund.name.toLowerCase() === get("fund").toLowerCase());
    if (matching.length !== 1) throw new Error(`Row ${index + 2}: choose an existing fund by its exact name.`);
    const parsed = offlineGiftSchema.safeParse({
      date: get("date"), amount: get("amount").replace(/^\$/, "").replaceAll(",", ""),
      fundId: matching[0].id, donorName: get("donor name"), donorEmail: get("donor email").toLowerCase(),
      method: get("method") || "cash", giftType: get("gift type") || "one_time",
    });
    if (!parsed.success) throw new Error(`Row ${index + 2}: ${parsed.error.issues[0].message}`);
    return parsed.data;
  });
}
