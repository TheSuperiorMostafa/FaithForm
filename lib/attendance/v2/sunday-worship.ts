/**
 * Which services the attendance Services board lists: Sunday worship.
 *
 * `church_service_times` is shared with the website and the phone assistant,
 * so it holds everything a church advertises — Sunday School, a Wednesday
 * prayer night, youth group — and every one of them became an attendance
 * "service". Churches count attendance at Sunday worship, the way the board
 * did before it listed every service on any day, so that is what it shows.
 *
 * A church names its worship service many ways ("Sunday Worship", "Morning
 * Service", "Early Service" / "Late Service", "Worship"), so this does not look
 * for a word it expects. It keeps any Sunday service whose name does not say
 * it is something else: a class, a group, a meal, a rehearsal. A service added
 * by hand is always kept — staff added it on purpose.
 */

const NOT_WORSHIP =
  /\b(school|class|classes|bible study|study|small groups?|groups?|kids|children|childrens|child|youth|students?|nursery|prayer|choir|rehearsal|practice|meeting|fellowship|breakfast|lunch|dinner|supper|potluck|training|membership)\b/i;

/** True when a `YYYY-MM-DD` calendar date is a Sunday. */
export function isSundayDate(localServiceDate: string): boolean {
  const [y, m, d] = localServiceDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** False when the name says the service is not worship (a class, a group, a meal…). */
export function isWorshipLabel(label: string): boolean {
  return !NOT_WORSHIP.test(label.replace(/[’']/g, ""));
}

export function isSundayWorshipOccurrence(occurrence: {
  label: string;
  localServiceDate: string;
  generationSource: string;
}): boolean {
  if (occurrence.generationSource === "manual") return true;
  return isSundayDate(occurrence.localServiceDate) && isWorshipLabel(occurrence.label);
}
