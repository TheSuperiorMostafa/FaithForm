/**
 * A calendar event's description as plain text.
 *
 * Google Calendar keeps what is typed into its web editor as HTML — `<br>`,
 * `<b>`, `<a href>` — while iCloud and FaithForm's own events are plain text.
 * The description becomes an announcement's details, which the phone apps
 * print as text, so tags would show up literally. Line breaks and list items
 * are kept as lines; everything else is reduced to its text.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

export function calendarDescriptionText(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw.replace(/\r\n?/g, "\n");

  if (/<[a-z/][^>]*>/i.test(text)) {
    text = text
      // A link keeps its address when the text shown is something else, so
      // the apps can still make it tappable.
      .replace(
        /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_match, href: string, label: string) => {
          const shown = label.replace(/<[^>]*>/g, "").trim();
          return !shown || shown === href ? href : `${shown} (${href})`;
        },
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|ul|ol|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, "");
  }

  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
