/**
 * The rules behind the Kids Check-in desk, kept pure so tests pin them.
 *
 * The desk is worked by volunteers while families stand in front of them, so
 * the screen is built around a family, not a child: type any name, get the
 * family card with every child already ticked, press one button. Everything
 * here is the arithmetic and wording that screen relies on.
 */

import {
  buildRosterSearchIndex,
  searchRoster,
  type CheckinChild,
  type RosterSearchIndex,
} from "@/lib/checkin/roster-search";
import type { CheckinSessionRow } from "@/types/checkin";

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** "8 checked in / room for 12", or just "8 checked in". */
export function occupancyLabel(count: number, capacity: number | null): string {
  return capacity != null
    ? `${count} checked in / room for ${capacity}`
    : `${count} checked in`;
}

/** "1 child", "2 children". */
export function childCount(count: number): string {
  return `${count} ${count === 1 ? "child" : "children"}`;
}

/** The desk's one big button: "Check in 2 children". */
export function checkInButtonLabel(count: number): string {
  if (count <= 0) return "Tick who is here";
  return `Check in ${childCount(count)}`;
}

/** The pickup desk's one big button: "Release 2 children". */
export function releaseButtonLabel(count: number): string {
  if (count <= 0) return "Tick who is leaving";
  return `Release ${childCount(count)}`;
}

/** "Tim", "Tim and Anna", "Tim, Anna and Joe". */
export function joinNames(names: readonly string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/**
 * A `YYYY-MM-DD` service date as a person says it: "Friday, September 25".
 * Parsed at UTC midnight and formatted in UTC, so the day never slips.
 */
export function formatServiceDate(isoDate: string, locale?: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(locale, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * How a grown-up is named on a release button: "Sarah Doe (mother)". The
 * label is whatever the family wrote down; without one, the relationship the
 * desk knows them by.
 */
export function pickupPersonLabel(
  name: string,
  label: string | null | undefined,
  fallback: string,
): string {
  const relation = label?.trim() || fallback;
  return relation ? `${name} (${relation.toLowerCase()})` : name;
}

// ---------------------------------------------------------------------------
// Pickup input: one box for a scanner and for a typed code
// ---------------------------------------------------------------------------

export type PickupInput =
  | { kind: "code"; value: string }
  | { kind: "qr"; value: string };

/**
 * A handheld scanner types a long signed token and presses Enter; a parent
 * reads out six digits. One box takes both: six digits (spaces and dashes
 * allowed) is a code, anything longer is a scanned QR, and anything else is
 * not ready to look up yet.
 */
export function classifyPickupInput(raw: string): PickupInput | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^[\d\s-]+$/.test(value)) {
    const digits = value.replace(/\D/g, "");
    return digits.length === 6 ? { kind: "code", value: digits } : null;
  }

  // A signed token is never short. Refusing short junk here means a stray
  // keypress is not sent off as a failed QR lookup.
  return value.length >= 16 ? { kind: "qr", value } : null;
}

// ---------------------------------------------------------------------------
// Family cards
// ---------------------------------------------------------------------------

export type DeskChildState =
  | { kind: "ready" }
  /** The parent pre-checked in from the app; nobody has received them yet. */
  | { kind: "on_the_way"; sessionId: string; locationId: string }
  | { kind: "checked_in"; sessionId: string; locationId: string; locationName: string };

export type DeskChild = CheckinChild & {
  medicalNotes?: string | null;
  state: DeskChildState;
};

export type DeskFamily = {
  householdId: string;
  name: string;
  guardianNames: string[];
  children: DeskChild[];
};

/** How many family cards the desk shows before asking for more letters. */
export const FAMILY_RESULT_LIMIT = 5;

function stateFor(
  childId: string,
  openSessions: ReadonlyMap<string, CheckinSessionRow>,
): DeskChildState {
  const session = openSessions.get(childId);
  if (!session) return { kind: "ready" };
  if (session.status === "pre_checked_in") {
    return { kind: "on_the_way", sessionId: session.id, locationId: session.locationId };
  }
  return {
    kind: "checked_in",
    sessionId: session.id,
    locationId: session.locationId,
    locationName: session.locationName,
  };
}

/**
 * The families matching what was typed, best match first.
 *
 * The search is the existing child search (which already matches a child's
 * own name, the family's name and a parent's name). A match on any child
 * brings the whole family: a parent who says "Sarah Doe" wants all three of
 * her children on the card, not only the one whose name ranked highest.
 */
export function searchFamilies(
  index: RosterSearchIndex<CheckinChild & { medicalNotes?: string | null }>,
  allChildren: readonly (CheckinChild & { medicalNotes?: string | null })[],
  query: string,
  openSessions: readonly CheckinSessionRow[],
  options: { limit?: number } = {},
): { families: DeskFamily[]; more: number } {
  const result = searchRoster(index, query, { limit: 60 });
  const byMember = new Map(openSessions.map((session) => [session.memberId, session]));

  const order: string[] = [];
  for (const { child } of result.matches) {
    if (!order.includes(child.householdId)) order.push(child.householdId);
  }

  const limit = Math.max(1, options.limit ?? FAMILY_RESULT_LIMIT);
  const families = order.slice(0, limit).map((householdId) => {
    const members = allChildren.filter((child) => child.householdId === householdId);
    const first = members[0];
    return {
      householdId,
      name: first?.householdName?.trim() || `${first?.lastName ?? ""} family`.trim(),
      guardianNames: first?.guardianNames ?? [],
      children: members
        .map((child) => ({ ...child, state: stateFor(child.id, byMember) }))
        .sort((a, b) => a.firstName.localeCompare(b.firstName)),
    } satisfies DeskFamily;
  });

  return { families, more: Math.max(0, order.length - limit) + result.more };
}

export { buildRosterSearchIndex };

/** Children the card ticks for the volunteer: everyone not already in a room. */
export function defaultSelection(family: DeskFamily): string[] {
  return family.children
    .filter((child) => child.state.kind !== "checked_in")
    .map((child) => child.id);
}

/**
 * The room a child starts with on the card: the room they are on the way to,
 * then the room an admin set as theirs, then the only open room if there is
 * just one. Otherwise the volunteer chooses.
 */
export function defaultRoomFor(
  child: DeskChild,
  activeRoomIds: readonly string[],
): string {
  if (child.state.kind === "on_the_way" && activeRoomIds.includes(child.state.locationId)) {
    return child.state.locationId;
  }
  if (child.defaultLocationId && activeRoomIds.includes(child.defaultLocationId)) {
    return child.defaultLocationId;
  }
  return activeRoomIds.length === 1 ? activeRoomIds[0] : "";
}

// ---------------------------------------------------------------------------
// Undo a check-in
// ---------------------------------------------------------------------------

/** How long after a check-in the desk may still take it back. */
export const UNDO_CHECKIN_WINDOW_MS = 10 * 60 * 1000;

export type UndoCheckinRow = {
  church_id: string;
  status: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
};

export type UndoCheckinRefusal =
  | "other_church"
  | "not_checked_in"
  | "released"
  | "too_old"
  | "someone_else";

/**
 * Whether a check-in may be undone, and if not, why.
 *
 * Only a check-in that is still open, was never released, belongs to this
 * church, was made by the same person, and is under ten minutes old. Anything
 * older is a real record of a child in a room, not a slip at the desk.
 */
export function undoCheckinRefusal(
  row: UndoCheckinRow,
  context: { churchId: string; userId: string; now: Date },
): UndoCheckinRefusal | null {
  if (row.church_id !== context.churchId) return "other_church";
  if (row.checked_out_at) return "released";
  if (row.status !== "checked_in") {
    return row.status === "checked_out" ? "released" : "not_checked_in";
  }
  if (!row.checked_in_at) return "not_checked_in";
  const at = new Date(row.checked_in_at).getTime();
  if (Number.isNaN(at)) return "not_checked_in";
  const age = context.now.getTime() - at;
  if (age > UNDO_CHECKIN_WINDOW_MS || age < -60_000) return "too_old";
  if (row.checked_in_by !== context.userId) return "someone_else";
  return null;
}

export const UNDO_CHECKIN_MESSAGES: Record<UndoCheckinRefusal, string> = {
  other_church: "We couldn't find that check-in. Refresh the page and try again.",
  not_checked_in: "That child isn't checked in any more, so there is nothing to undo.",
  released: "That child has already been picked up, so the check-in can't be undone.",
  too_old:
    "A check-in can only be undone in the first 10 minutes. Ask a church admin to correct it.",
  someone_else: "Only the person who checked this child in can undo it.",
};

/** The cut-off timestamp for the undo window, for the database filter. */
export function undoCheckinCutoff(now: Date): string {
  return new Date(now.getTime() - UNDO_CHECKIN_WINDOW_MS).toISOString();
}

// ---------------------------------------------------------------------------
// New family at the desk
// ---------------------------------------------------------------------------

export type NewFamilyChildInput = {
  firstName: string;
  lastName?: string;
  locationId: string;
  medicalNotes?: string;
};

export type NewFamilyInput = {
  guardianFirstName: string;
  guardianLastName: string;
  guardianPhone?: string;
  children: NewFamilyChildInput[];
};

export type ParsedNewFamily = {
  guardian: { firstName: string; lastName: string; phone: string };
  children: { firstName: string; lastName: string; locationId: string; medicalNotes: string | null }[];
  familyName: string;
};

export const NEW_FAMILY_MAX_CHILDREN = 10;
const MEDICAL_NOTES_MAX = 1000;

/**
 * Shape and sense checks for the "New family" form, before anything is
 * written. Phone numbers are checked again by the People rules on the server.
 */
export function parseNewFamily(
  input: NewFamilyInput,
): { ok: true; data: ParsedNewFamily } | { ok: false; error: string } {
  const guardianFirstName = input.guardianFirstName?.trim() ?? "";
  const guardianLastName = input.guardianLastName?.trim() ?? "";
  if (!guardianFirstName) return { ok: false, error: "Add the parent's first name." };
  if (!guardianLastName) return { ok: false, error: "Add the parent's last name." };

  const rows = (input.children ?? []).filter(
    (child) =>
      child.firstName?.trim() ||
      child.lastName?.trim() ||
      child.medicalNotes?.trim(),
  );
  if (rows.length === 0) return { ok: false, error: "Add at least one child." };
  if (rows.length > NEW_FAMILY_MAX_CHILDREN) {
    return { ok: false, error: `A family can have up to ${NEW_FAMILY_MAX_CHILDREN} children here.` };
  }

  const children: ParsedNewFamily["children"] = [];
  for (const [index, child] of rows.entries()) {
    const firstName = child.firstName?.trim() ?? "";
    const which = rows.length === 1 ? "the child" : `child ${index + 1}`;
    if (!firstName) return { ok: false, error: `Add a first name for ${which}.` };
    if (!child.locationId?.trim()) {
      return { ok: false, error: `Choose a room for ${firstName}.` };
    }
    const notes = child.medicalNotes?.trim() ?? "";
    if (notes.length > MEDICAL_NOTES_MAX) {
      return { ok: false, error: `The allergy and medical notes for ${firstName} are too long.` };
    }
    children.push({
      firstName,
      lastName: child.lastName?.trim() || guardianLastName,
      locationId: child.locationId.trim(),
      medicalNotes: notes || null,
    });
  }

  return {
    ok: true,
    data: {
      guardian: {
        firstName: guardianFirstName,
        lastName: guardianLastName,
        phone: input.guardianPhone?.trim() ?? "",
      },
      children,
      familyName: `${guardianLastName} family`,
    },
  };
}
