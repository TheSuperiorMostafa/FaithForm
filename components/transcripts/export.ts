import { formatTime } from "@/components/sermon-media/time";

/**
 * The transcript as a plain .txt someone can open, print or paste: the title,
 * the service date, then one line per spoken line with its time. The sermon's
 * start and end are marked when they are known. Pure, so it is unit tested.
 */
export function transcriptToText(input: {
  title: string;
  dateLabel?: string | null;
  segments: { start: number; text: string }[];
  sermon?: { startSec: number; endSec: number } | null;
}): string {
  const lines: string[] = [input.title.trim() || "Transcript"];
  if (input.dateLabel) lines.push(input.dateLabel);
  lines.push("");

  const sermon = input.sermon ?? null;
  let startMarked = false;
  let endMarked = false;
  for (const segment of input.segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (sermon && !startMarked && segment.start >= sermon.startSec - 0.5) {
      lines.push(`--- Sermon starts (${formatTime(sermon.startSec)}) ---`);
      startMarked = true;
    }
    if (sermon && startMarked && !endMarked && segment.start >= sermon.endSec) {
      lines.push(`--- Sermon ends (${formatTime(sermon.endSec)}) ---`);
      endMarked = true;
    }
    lines.push(`[${formatTime(segment.start)}] ${text}`);
  }
  if (sermon && startMarked && !endMarked) lines.push(`--- Sermon ends (${formatTime(sermon.endSec)}) ---`);
  return `${lines.join("\n")}\n`;
}

/** "Sunday Service: Hope!" → "sunday-service-hope-transcript.txt". */
export function transcriptFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "service"}-transcript.txt`;
}

/** Saves the text as a file in the browser. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
