import { z } from "zod";

import { toE164 } from "@/lib/sms/phone";
import { JOIN_POLICIES } from "@/lib/faithful/relationship-state";

/** Bounded everywhere: no list endpoint may be asked for an unbounded page. */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursorName: z.string().trim().max(200).optional(),
  cursorId: z.string().uuid().optional(),
});

export type PageInput = z.infer<typeof pageSchema>;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const discoverySearchSchema = pageSchema.extend({
  query: z.string().trim().min(1).max(120).optional(),
  state: z.string().trim().length(2).optional(),
  postalCode: z.string().trim().max(12).optional(),
});

export const churchSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Invalid church identifier.");

/**
 * Email and phone are normalized only so a human comparing two values sees
 * comparable text. Normalizing is not matching: nothing in this codebase joins
 * People on these columns.
 */
export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim().toLowerCase() ?? "";
  if (!trimmedValue) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue) ? trimmedValue : null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return toE164(value);
}

export const visitorProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  avatarUrl: z.string().trim().url().max(2048).optional().nullable(),
  communicationPrefs: z.record(z.string(), z.boolean()).optional(),
  selectedChurchSlug: churchSlugSchema.optional().nullable(),
});

export const consentSchema = z.object({
  termsVersion: z.string().trim().max(40).optional(),
  privacyVersion: z.string().trim().max(40).optional(),
  autoAttendanceConsent: z.enum(["granted", "denied", "revoked"]).optional(),
  autoAttendanceConsentVersion: z.string().trim().max(40).optional(),
});

export const joinPolicySchema = z.enum(JOIN_POLICIES);

export const discoverySettingsSchema = z.object({
  isDiscoverable: z.boolean(),
  publicSummary: z.string().trim().max(600).optional().nullable(),
  joinPolicy: joinPolicySchema,
});

/**
 * Coordinates are optional but never half-supplied — the same rule the
 * database enforces, stated here so the user gets a sentence instead of a
 * constraint violation.
 */
export const campusSchema = z
  .object({
    name: trimmed(120),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens."),
    addressLine1: z.string().trim().max(200).optional().nullable(),
    addressLine2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    state: z.string().trim().max(60).optional().nullable(),
    postalCode: z.string().trim().max(12).optional().nullable(),
    country: z.string().trim().length(2).default("US"),
    latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
    longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
    timezone: z.string().trim().min(1).max(64),
    geofenceRadiusM: z.coerce.number().int().min(25).max(2000).default(150),
    isActive: z.boolean().default(true),
    isPublic: z.boolean().default(true),
    isPrimary: z.boolean().default(false),
    sortKey: z.coerce.number().int().min(0).max(9999).default(0),
  })
  .refine(
    (value) =>
      (value.latitude === null || value.latitude === undefined) ===
      (value.longitude === null || value.longitude === undefined),
    { message: "Provide both latitude and longitude, or neither.", path: ["latitude"] },
  )
  .refine((value) => isValidTimeZone(value.timezone), {
    message: "Enter a valid IANA timezone, for example America/New_York.",
    path: ["timezone"],
  });

export type CampusInput = z.infer<typeof campusSchema>;

/**
 * Asks the runtime rather than carrying a list that would go stale. The
 * database enforces this again on write; both layers matter, because a bad
 * zone here is a form error and a bad zone there is a corrupted schedule.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const claimRequestSchema = z.object({
  churchSlug: churchSlugSchema,
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  /**
   * Present and rejected on purpose. Prompt 3 implements self-managed accounts
   * only; a claim on someone else's behalf fails closed rather than being
   * silently treated as a claim for the requester.
   */
  onBehalfOfMemberId: z.string().uuid().optional(),
});

export const claimResolutionSchema = z.object({
  claimId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});

export const invitationSchema = z.object({
  purpose: z.enum(["join", "people_claim"]),
  memberId: z.string().uuid().optional(),
  invitedEmail: z.string().trim().max(200).optional(),
  invitedLabel: z.string().trim().max(120).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(14),
  maxUses: z.coerce.number().int().min(1).max(500).default(1),
});

export const accountRequestSchema = z.object({
  kind: z.enum(["export", "deletion"]),
  idempotencyKey: z.string().trim().min(8).max(120),
});
