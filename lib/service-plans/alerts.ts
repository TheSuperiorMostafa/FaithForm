/**
 * Who staff want told when someone answers a shared plan, and what they are
 * told. Pure: the settings action cleans with these, the share page's answer
 * action words the alert with these, and both are unit tested.
 */

import { UserFacingError } from "@/lib/errors/user-error";
import { toE164 } from "@/lib/sms/phone";
import type { TeamMemberStatus } from "@/lib/service-plans/types";

export const MAX_ALERT_CONTACTS = 10;

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;

function entries(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,;]+/) : [];
  return list.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

/** Lower-cased, de-duplicated emails; a bad one is named back to the planner. */
export function cleanAlertEmails(value: unknown): string[] {
  const out: string[] = [];
  for (const raw of entries(value)) {
    const email = raw.toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) {
      throw new UserFacingError(`“${raw.slice(0, 80)}” isn’t an email address. Check it and save again.`);
    }
    if (!out.includes(email)) out.push(email);
  }
  if (out.length > MAX_ALERT_CONTACTS) {
    throw new UserFacingError(`Add up to ${MAX_ALERT_CONTACTS} email addresses.`);
  }
  return out;
}

/** E.164, de-duplicated mobile numbers; a bad one is named back to the planner. */
export function cleanAlertPhones(value: unknown): string[] {
  const out: string[] = [];
  for (const raw of entries(value)) {
    const phone = toE164(raw);
    if (!phone) {
      throw new UserFacingError(`“${raw.slice(0, 40)}” isn’t a mobile number we can text. Use 10 digits, like 502-555-0100.`);
    }
    if (!out.includes(phone)) out.push(phone);
  }
  if (out.length > MAX_ALERT_CONTACTS) {
    throw new UserFacingError(`Add up to ${MAX_ALERT_CONTACTS} mobile numbers.`);
  }
  return out;
}

export type AnswerAlert = {
  churchName: string;
  personName: string;
  status: Exclude<TeamMemberStatus, "unconfirmed">;
  /** The answer before this one, when they changed their mind. */
  previous: Exclude<TeamMemberStatus, "unconfirmed"> | null;
  serviceTypeName: string;
  /** "Sunday, November 23" */
  when: string;
};

/** "Jane Smith will be there" / "Jane Smith can't make it". */
export function answerHeadline(alert: Pick<AnswerAlert, "personName" | "status">): string {
  return alert.status === "confirmed" ? `${alert.personName} will be there` : `${alert.personName} can’t make it`;
}

/** The text message staff get. Short: one SMS segment where the names allow. */
export function answerSmsBody(alert: AnswerAlert): string {
  const changed = alert.previous && alert.previous !== alert.status ? " (changed their answer)" : "";
  return `${alert.churchName}: ${answerHeadline(alert)}${changed} for ${alert.serviceTypeName}, ${alert.when}.`;
}
