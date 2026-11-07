/** A person's relationship with the church, separate from attendance and app access. */
export const MEMBERSHIP_STATUSES = [
  { value: "member", label: "Member" },
  { value: "regular_attender", label: "Regular Attender" },
  { value: "newcomer", label: "Newcomer" },
  { value: "visitor", label: "Visitor" },
  { value: "former", label: "Former" },
  { value: "unknown", label: "Unknown" },
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]["value"];

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return MEMBERSHIP_STATUSES.some(status => status.value === value);
}
