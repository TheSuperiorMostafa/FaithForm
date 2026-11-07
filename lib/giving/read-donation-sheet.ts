import JSZip from "jszip";
import { parseDonationCsv } from "@/lib/giving/offline-input";

/** Browser-only reader. Files stay local until the reviewed rows are saved. */
export async function readDonationSheet(file: File): Promise<string[][]> {
  if (file.size > 2_000_000) throw new Error("Choose a spreadsheet smaller than 2 MB.");
  if (/\.csv$/i.test(file.name)) return parseDonationCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Save your spreadsheet as .xlsx or .csv first.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (Object.keys(zip.files).length > 1000) throw new Error("This workbook has too many files. Export just the donation sheet as CSV.");
  const xml = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) return null;
    const text = await new Promise<string>((resolve, reject) => {
      let output = "";
      // JSZip exposes this streaming method at runtime; its object typings
      // omit it, although the same StreamHelper type is exported.
      const stream = (entry as JSZip.JSZipObject & {
        internalStream(type: "string"): JSZip.JSZipStreamHelper<string>;
      }).internalStream("string");
      stream.on("data", chunk => {
        output += chunk;
        if (output.length > 5_000_000) {
          stream.pause();
          reject(new Error("This sheet is too large. Export up to 500 donations at a time."));
        }
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(output));
      stream.resume();
    });
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("This workbook could not be read. Try exporting it as CSV.");
    return doc;
  };
  const shared = await xml("xl/sharedStrings.xml");
  const strings = Array.from(shared?.querySelectorAll("si") ?? []).map(si => si.textContent ?? "");
  const workbook = await xml("xl/workbook.xml");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const firstSheet = workbook?.querySelector("sheet");
  const relation = firstSheet?.getAttribute("r:id");
  const target = Array.from(rels?.querySelectorAll("Relationship") ?? []).find(rel => rel.getAttribute("Id") === relation)?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  if (path.includes("..")) throw new Error("Export the first donation sheet as CSV.");
  const sheet = await xml(path);
  if (!sheet) throw new Error("The first worksheet is missing.");
  const rows = Array.from(sheet.querySelectorAll("sheetData > row"));
  if (rows.length > 501) throw new Error("Import up to 500 donations at a time.");
  const cells = rows.map(row => {
    const values: string[] = [];
    for (const cell of row.querySelectorAll("c")) {
      const letters = cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0] ?? "A";
      const index = [...letters].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
      if (index > 50) throw new Error("Keep the donation sheet to 50 columns or fewer.");
      const type = cell.getAttribute("t");
      const value = cell.querySelector("v")?.textContent ?? "";
      if (cell.querySelector("f")) throw new Error("Replace spreadsheet formulas with their values before importing.");
      values[index] = type === "s" ? strings[Number(value)] ?? "" : type === "inlineStr" ? cell.querySelector("is")?.textContent ?? "" : value;
    }
    return values;
  }).filter(row => row.some(value => value?.trim()));
  const dateIndex = cells[0]?.findIndex(value => value.trim().toLowerCase() === "date") ?? -1;
  for (const row of cells.slice(1)) {
    const value = row[dateIndex];
    if (value && /^\d{4,6}(\.\d+)?$/.test(value)) {
      // Excel's 1900 date system includes a fictitious leap day.
      const serial = Number(value);
      const use1904 = workbook?.querySelector("workbookPr")?.getAttribute("date1904") === "1";
      row[dateIndex] = new Date((use1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + serial * 86400000).toISOString().slice(0, 10);
    }
  }
  return cells;
}
