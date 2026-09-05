export const HOUSEHOLD_RELATIONSHIPS = [
  "guardian",
  "dependent",
  "other",
] as const;

export type HouseholdRelationship = (typeof HOUSEHOLD_RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<HouseholdRelationship, string> = {
  guardian: "Guardian",
  dependent: "Child",
  other: "Household member",
};

/**
 * What each relationship actually grants. Shown next to the picker, because
 * "guardian" reads as a description and is in fact a permission — the mistake
 * that matters here is made at the moment somebody chooses one.
 */
export const RELATIONSHIP_DESCRIPTIONS: Record<HouseholdRelationship, string> = {
  guardian: "May collect this household's children, and holds its pickup code.",
  dependent: "May be checked in under this household. Cannot collect anyone.",
  other: "Belongs to the household. Neither collects nor is collected.",
};

export const CHECKIN_STATUSES = [
  "pre_checked_in",
  "checked_in",
  "checked_out",
  "cancelled",
] as const;

export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

export const CHECKIN_STATUS_LABELS: Record<CheckinStatus, string> = {
  pre_checked_in: "Pre-checked in",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
};

export type CheckinMethod = "app" | "kiosk" | "staff";
export type CheckoutMethod = "qr" | "code" | "override";

export const CHECKOUT_METHOD_LABELS: Record<CheckoutMethod, string> = {
  qr: "QR code",
  code: "6-digit code",
  override: "Staff override",
};

export type ChurchLocation = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  capacity: number | null;
  isDefaultAdultLocation: boolean;
  isActive: boolean;
};

export type HouseholdMemberRow = {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  relationship: HouseholdRelationship;
  relationshipLabel: string | null;
  isPrimaryContact: boolean;
  phone: string | null;
  email: string | null;
  medicalNotes: string | null;
  defaultLocationId: string | null;
};

export type HouseholdSummary = {
  id: string;
  name: string;
  memberCount: number;
  guardianCount: number;
  dependentCount: number;
};

export type HouseholdDetail = HouseholdSummary & {
  notes: string | null;
  codeRotation: number;
  members: HouseholdMemberRow[];
  pickupAuthorizations: {
    id: string;
    memberId: string;
    firstName: string;
    lastName: string;
    relationshipLabel: string | null;
  }[];
};

export type CheckinSessionRow = {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  householdId: string | null;
  householdName: string | null;
  locationId: string;
  locationName: string;
  status: CheckinStatus;
  localServiceDate: string;
  preCheckedInAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  checkinMethod: CheckinMethod | null;
  checkoutMethod: CheckoutMethod | null;
  checkoutOverrideReason: string | null;
  /** Read live rather than snapshotted — an allergy noted this morning counts. */
  medicalNotes: string | null;
};

export type LocationHeadcount = {
  locationId: string;
  locationName: string;
  /** week start (`YYYY-MM-DD`) → number of people checked in that week. */
  byWeek: Record<string, number>;
  total: number;
};

export type MemberFile = {
  id: string;
  memberId: string;
  label: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: "church_admin" | "staff";
  uploadedByName: string | null;
  expiresOn: string | null;
  createdAt: string;
};
