/**
 * The facts an announcement must get right — where and when — resolved once
 * from what the church saved, and handed to both the caption writer and the
 * flyer model as fixed text.
 *
 * A flyer came back with the church's own street misspelled: the model had
 * been handed the whole calendar string ("4308 Taylorsville Rd, Louisville,
 * KY 40220, USA") and asked to letter it. The longer the string, the more an
 * image model garbles it, so the flyer now gets one short line, and when the
 * event is at the church that line is the street the church saved, not
 * whatever the calendar typed.
 */

export type ChurchAddress = {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type ResolvedEventLocation = {
  /** The place as the caption should state it, verbatim. Empty when unknown. */
  full: string;
  /** One short line for the flyer, or null to leave location off the image. */
  flyerLine: string | null;
  /** The event is at the church's own saved address (or no place was given). */
  atChurch: boolean;
  /** No place was typed; `full` is the church's saved address, assumed. */
  assumed: boolean;
};

const MAX_FLYER_LOCATION = 40;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "4308 Taylorsville Rd, Louisville, KY 40220" from the saved columns. */
export function formatChurchAddress(church: ChurchAddress): string {
  const street = clean(church.address);
  const city = clean(church.city);
  const stateZip = [clean(church.state), clean(church.zip)].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}

/**
 * True when the typed location is the church itself: it names the church, or
 * it carries the saved street number and street name.
 */
export function isChurchLocation(location: string, church: ChurchAddress): boolean {
  const typed = normalize(location);
  if (!typed) return false;

  const name = normalize(church.name);
  if (name && typed.includes(name)) return true;

  const street = normalize(clean(church.address));
  const match = street.match(/^(\d+[a-z]?)\s+(.+)$/);
  if (!match) return street.length > 0 && typed.includes(street);
  const [, number, rest] = match;
  // Same house number plus the start of the street name, so a calendar's
  // small misspelling ("Taylorsvile") still counts as the church.
  const stem = rest.split(" ")[0].slice(0, 5);
  return new RegExp(`\\b${number}\\b`).test(typed) && typed.includes(stem);
}

/**
 * The short form of a typed place: a venue's name when it has one
 * ("Heine Brothers Coffee - Hikes Point"), otherwise its street line
 * ("4308 Taylorsville Rd"). Never the city, state, zip, or country.
 */
export function shortLocation(location: string): string {
  const parts = clean(location)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0] ?? "";
  if (first.length <= MAX_FLYER_LOCATION) return first;
  // A long venue name: keep the part before a " - " branch suffix if that fits.
  const head = first.split(/\s[-–—]\s/)[0]?.trim() ?? "";
  return head.length <= MAX_FLYER_LOCATION ? head : "";
}

export function resolveEventLocation(
  location: string | null | undefined,
  church: ChurchAddress,
): ResolvedEventLocation {
  const typed = clean(location).replace(/,\s*(USA|United States)$/i, "");
  const churchStreet = clean(church.address);

  if (!typed) {
    return {
      full: formatChurchAddress(church),
      // Nobody said where; do not print a guess on the picture.
      flyerLine: null,
      atChurch: true,
      assumed: true,
    };
  }

  if (isChurchLocation(typed, church)) {
    return {
      full: formatChurchAddress(church) || typed,
      flyerLine: churchStreet && churchStreet.length <= MAX_FLYER_LOCATION
        ? churchStreet
        : shortLocation(typed) || null,
      atChurch: true,
      assumed: false,
    };
  }

  return {
    full: typed,
    flyerLine: shortLocation(typed) || null,
    atChurch: false,
    assumed: false,
  };
}

/**
 * The date as a caption reader wants it: "Friday, October 30 · 6:30 PM – 8:00 PM",
 * in the church's zone. All-day entries carry no time.
 */
export function formatCaptionWhen(
  startAt: string,
  endAt: string | null | undefined,
  timeZone: string,
  allDay?: boolean,
): string {
  const zone = allDay ? "UTC" : timeZone;
  const start = new Date(allDay && /^\d{4}-\d{2}-\d{2}$/.test(startAt) ? `${startAt}T12:00:00Z` : startAt);
  if (Number.isNaN(start.getTime())) return "";

  const day = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: zone,
  });
  if (allDay) return `${day} · all day`;

  const time = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  const end = endAt ? new Date(endAt) : null;
  const sameDay =
    end &&
    !Number.isNaN(end.getTime()) &&
    end.getTime() > start.getTime() &&
    end.toLocaleDateString("en-US", { timeZone: zone }) ===
      start.toLocaleDateString("en-US", { timeZone: zone });

  return sameDay ? `${day} · ${time(start)} – ${time(end!)}` : `${day} · ${time(start)}`;
}

/**
 * The writer is told to include the date and place exactly; this makes sure
 * of it. A caption missing either gets the fact appended as its own line, so
 * a post can never go out without the real when and where.
 */
export function ensureCaptionDetails(
  caption: string,
  details: { when: string; location: string | null },
): string {
  let text = caption.trim();
  const lower = text.toLowerCase();
  const missing: string[] = [];

  const dayName = details.when.split(",")[0]?.trim().toLowerCase();
  const monthDay = details.when.split(",")[1]?.split("·")[0]?.trim().toLowerCase();
  if (details.when && !(monthDay && lower.includes(monthDay)) && !(dayName && lower.includes(dayName))) {
    missing.push(`📅 ${details.when}`);
  }

  const place = details.location?.trim();
  if (place) {
    const key = shortLocation(place).toLowerCase() || place.toLowerCase();
    if (!lower.includes(key)) missing.push(`📍 ${place}`);
  }

  if (missing.length) text = `${text}\n\n${missing.join("\n")}`;
  return text;
}

/** Northern-hemisphere season of the event, for the image's light and mood. */
export function eventSeason(startAt: string | undefined, timeZone: string): string | null {
  if (!startAt) return null;
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return null;
  const month = Number(
    date.toLocaleDateString("en-US", { month: "numeric", timeZone }),
  );
  if ([12, 1, 2].includes(month)) return "winter";
  if ([3, 4, 5].includes(month)) return "spring";
  if ([6, 7, 8].includes(month)) return "summer";
  return "autumn";
}
