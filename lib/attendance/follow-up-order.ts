/**
 * Order for the "Who missed this Sunday" list on Attendance › Follow-up.
 *
 * People we can text (a phone number on file) come first, so the pastor sees
 * who they can reach without scrolling past people they can't. Within each
 * group the longest streak of missed Sundays leads, then names A to Z.
 */
export type FollowUpSortable = {
  name: string;
  phone: string | null | undefined;
  consecutiveAbsent: number;
};

export function hasFollowUpPhone(candidate: { phone: string | null | undefined }): boolean {
  return Boolean(candidate.phone?.trim());
}

/** Streak (longest first), then name. The order inside each phone group. */
function byStreakThenName(a: FollowUpSortable, b: FollowUpSortable): number {
  if (b.consecutiveAbsent !== a.consecutiveAbsent) {
    return b.consecutiveAbsent - a.consecutiveAbsent;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Moves everyone with a phone number above everyone without one, keeping the
 * incoming order inside each group (a stable partition). Returns a new array.
 */
export function phoneNumbersFirst<T extends { phone: string | null | undefined }>(
  candidates: readonly T[],
): T[] {
  const withPhone: T[] = [];
  const withoutPhone: T[] = [];
  for (const candidate of candidates) {
    (hasFollowUpPhone(candidate) ? withPhone : withoutPhone).push(candidate);
  }
  return [...withPhone, ...withoutPhone];
}

/** The full follow-up order: phone numbers first, then streak, then name. */
export function sortFollowUpCandidates<T extends FollowUpSortable>(candidates: readonly T[]): T[] {
  return phoneNumbersFirst([...candidates].sort(byStreakThenName));
}
