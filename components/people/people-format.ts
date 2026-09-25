/**
 * Pure helpers for the People and Families screens. Kept free of React so the
 * rules they encode (what a row says, which contact buttons appear, how a
 * week reads) can be tested directly.
 */

import type { StatusTone } from "@/components/ui/status-badge";
import { formatPhoneDisplay } from "@/lib/people/validate-member";
import type { HouseholdRelationship, HouseholdSummary } from "@/types/checkin";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * A friendly date. A church calendar day ("2026-09-13") is read at noon UTC
 * and printed in UTC, so no viewer's timezone can move it to the day before.
 */
export function formatFriendlyDate(
  value: string | null | undefined,
  options: { weekday?: boolean; year?: boolean } = {},
): string | null {
  if (!value) return null;
  const isCalendarDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isCalendarDay ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    ...(options.weekday ? { weekday: "long" as const } : {}),
    month: options.weekday ? "long" : "short",
    day: "numeric",
    ...(options.year === false ? {} : { year: "numeric" as const }),
    ...(isCalendarDay ? { timeZone: "UTC" } : {}),
  });
}

/** "2026-09-20" → "For the week of Sunday, September 20". */
export function formatWeekOf(weekStart: string | null | undefined): string | null {
  const day = formatFriendlyDate(weekStart, { weekday: true, year: false });
  return day ? `For the week of ${day}` : null;
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export type ContactLinks = {
  call: string | null;
  text: string | null;
  email: string | null;
};

/**
 * The Call / Text / Email links for a person. A button only exists when the
 * detail behind it does: a Call button for someone with no phone would be a
 * promise the page can't keep.
 */
export function contactLinks(person: {
  phone?: string | null;
  email?: string | null;
}): ContactLinks {
  const raw = person.phone?.trim() ?? "";
  // Keep one leading + and the digits; spaces, dashes and brackets confuse
  // some dialers.
  const digits = raw.replace(/\D/g, "");
  const dial = digits.length >= 7 ? `${raw.startsWith("+") ? "+" : ""}${digits}` : null;
  const email = person.email?.trim() ?? "";
  // No characters that would start a mailto query (?, &) or break the link.
  const validEmail = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? email : null;

  return {
    call: dial ? `tel:${dial}` : null,
    text: dial ? `sms:${dial}` : null,
    email: validEmail ? `mailto:${validEmail}` : null,
  };
}

export function hasAnyContact(links: ContactLinks): boolean {
  return Boolean(links.call || links.text || links.email);
}

// ---------------------------------------------------------------------------
// People list
// ---------------------------------------------------------------------------

export type PersonLike = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};

export type PeopleFilter = "all" | "on-app" | "missing-phone" | "inactive";
export type PeopleSort = "last-name" | "first-name";

export function fullName(person: { first_name: string; last_name: string }): string {
  return `${person.first_name} ${person.last_name}`.trim();
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** The one line under a person's name. */
export function personContext(person: Pick<PersonLike, "phone" | "email">): string {
  const phone = person.phone?.trim() ? formatPhoneDisplay(person.phone) ?? person.phone : null;
  if (phone) return phone;
  return "No phone yet";
}

/**
 * The one status a row shows, or none. Only states that change what someone
 * does: an inactive person is not on the weekly sheet, and someone on the app
 * checks themselves in. "Text ready" is gone: nothing on the page sends one.
 */
export function personStatus(
  person: Pick<PersonLike, "is_active">,
  onApp: boolean,
): { tone: StatusTone; label: string } | null {
  if (!person.is_active) return { tone: "neutral", label: "Inactive" };
  if (onApp) return { tone: "ready", label: "On the app" };
  return null;
}

export function countPeople(
  members: PersonLike[],
  isOnApp: (id: string) => boolean,
): Record<PeopleFilter, number> {
  let all = 0;
  let onApp = 0;
  let missingPhone = 0;
  let inactive = 0;
  for (const member of members) {
    if (!member.is_active) {
      inactive += 1;
      continue;
    }
    all += 1;
    if (isOnApp(member.id)) onApp += 1;
    if (!member.phone?.trim()) missingPhone += 1;
  }
  return { all, "on-app": onApp, "missing-phone": missingPhone, inactive };
}

export function filterPeople<T extends PersonLike>(
  members: T[],
  {
    search,
    filter,
    sortBy,
    isOnApp,
  }: {
    search: string;
    filter: PeopleFilter;
    sortBy: PeopleSort;
    isOnApp: (id: string) => boolean;
  },
): T[] {
  const query = search.trim().toLowerCase();

  let list = members.filter((member) => {
    if (filter === "inactive") return !member.is_active;
    if (!member.is_active) return false;
    if (filter === "missing-phone") return !member.phone?.trim();
    if (filter === "on-app") return isOnApp(member.id);
    return true;
  });

  if (query) {
    // Numbers are stored as +15025551234 and shown as 502-555-1234; compare
    // digits so "502-555", "(502) 555" and "5025551234" all find the person.
    const queryDigits = query.replace(/\D/g, "");
    list = list.filter((member) => {
      const name = fullName(member).toLowerCase();
      const phoneDigits = (member.phone ?? "").replace(/\D/g, "");
      const email = (member.email ?? "").toLowerCase();
      return (
        name.includes(query) ||
        (queryDigits.length > 0 && phoneDigits.includes(queryDigits)) ||
        email.includes(query)
      );
    });
  }

  const sorted = [...list];
  sorted.sort((a, b) => {
    const [first, second] =
      sortBy === "first-name"
        ? [a.first_name.localeCompare(b.first_name), a.last_name.localeCompare(b.last_name)]
        : [a.last_name.localeCompare(b.last_name), a.first_name.localeCompare(b.first_name)];
    return first !== 0 ? first : second;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Needs your attention
// ---------------------------------------------------------------------------

export function attentionSummary(counts: {
  joinRequests: number;
  claims: number;
  notInPeople: number;
}): string {
  const parts: string[] = [];
  if (counts.joinRequests > 0) {
    parts.push(
      `${counts.joinRequests} ${counts.joinRequests === 1 ? "person" : "people"} asked to join`,
    );
  }
  if (counts.claims > 0) {
    parts.push(
      `${counts.claims} ${counts.claims === 1 ? "person" : "people"} to confirm`,
    );
  }
  if (counts.notInPeople > 0) {
    parts.push(`${counts.notInPeople} from the app to add`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/** What each answer means, in the words a front desk uses. */
export const FAMILY_ROLE_HINTS: Record<HouseholdRelationship, string> = {
  guardian: "Can pick up this family's children and gets the family's pickup code.",
  dependent: "Can be checked in with this family. Can't pick anyone up.",
  other: "Part of the family. Doesn't pick up children and isn't checked in as a child.",
};

export function familySummary(
  family: Pick<HouseholdSummary, "memberCount" | "guardianCount" | "dependentCount">,
): string {
  if (family.memberCount === 0) return "No one added yet";
  const parts = [`${family.memberCount} ${family.memberCount === 1 ? "person" : "people"}`];
  if (family.guardianCount > 0) {
    parts.push(
      `${family.guardianCount} ${family.guardianCount === 1 ? "parent or guardian" : "parents or guardians"}`,
    );
  }
  if (family.dependentCount > 0) {
    parts.push(`${family.dependentCount} ${family.dependentCount === 1 ? "child" : "children"}`);
  }
  return parts.join(" · ");
}

export function familyStatus(
  family: Pick<HouseholdSummary, "memberCount" | "guardianCount" | "dependentCount">,
): { tone: StatusTone; label: string } | null {
  if (family.guardianCount === 0 && family.dependentCount > 0) {
    return { tone: "attention", label: "No parent or guardian" };
  }
  if (family.memberCount === 0) return { tone: "neutral", label: "Empty" };
  return null;
}

/** "Lopez" → "The Lopez family". */
export function suggestedFamilyName(lastName: string, firstName = ""): string {
  const base = lastName.trim() || firstName.trim();
  return base ? `The ${base} family` : "";
}
