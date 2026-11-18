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

/** Gender as recorded in People. Left blank until someone chooses. */
export const MEMBER_GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
] as const;

export type MemberGender = (typeof MEMBER_GENDERS)[number]["value"];

export function isMemberGender(value: unknown): value is MemberGender {
  return MEMBER_GENDERS.some(gender => gender.value === value);
}
