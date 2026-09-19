import { z } from "zod";

import { MOBILE_ERROR_CODE_LIST } from "@/lib/mobile/v1/errors";
import { RELATIONSHIP_STATES, JOIN_POLICIES } from "@/lib/faithform/relationship-state";

/**
 * The canonical mobile contract.
 *
 * This file is the single source of truth. `scripts/generate-contract.mjs`
 * derives the JSON Schema, the Swift models, and the Kotlin models from it, and
 * CI fails if any generated output drifts. There is deliberately no second
 * handwritten definition of these shapes in Swift or Kotlin.
 *
 * Two rules govern every schema here:
 *
 *  1. **Sensitive fields are absent, not hidden.** Staff roles, feature grants,
 *     People identifiers, integration tokens, Stripe state, stream credentials
 *     and internal row ids never appear — so no UI mistake can reveal them.
 *  2. **Additive changes only.** A released client must tolerate new fields, so
 *     everything optional is genuinely optional and nothing is ever renamed
 *     within a major version.
 */

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** RFC 3339, always UTC, always with an explicit offset. */
const instant = z.string().describe("RFC 3339 UTC instant, e.g. 2026-08-24T14:03:00Z");

/** The public church handle. Never the internal uuid. */
const churchSlug = z.string().min(1).max(120);

const url = z.string().max(2048);

// ---------------------------------------------------------------------------
// Enums — forward-compatible on the client side
// ---------------------------------------------------------------------------

export const relationshipStateSchema = z.enum(
  RELATIONSHIP_STATES as unknown as [string, ...string[]],
);
export const joinPolicySchema = z.enum(
  JOIN_POLICIES as unknown as [string, ...string[]],
);
export const consentStateSchema = z.enum(["unset", "granted", "denied", "revoked"]);
export const accountStatusSchema = z.enum([
  "active",
  "deactivated",
  "deletion_requested",
  "deleted",
]);
export const accountRequestKindSchema = z.enum(["export", "deletion"]);
export const accountRequestStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const errorCodeSchema = z.enum(
  MOBILE_ERROR_CODE_LIST as unknown as [string, ...string[]],
);

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Named rather than inline so every generated language gets one real type. */
export const deprecationSchema = z.object({
  sunsetOn: instant,
  replacement: z.string(),
}).meta({ id: "Deprecation" });

export const fieldIssueSchema = z.object({
  field: z.string(),
  issue: z.string(),
}).meta({ id: "FieldIssue" });

export const metaSchema = z.object({
  apiVersion: z.string(),
  apiMajor: z.number().int(),
  requestId: z.string(),
  minimumSupportedClientBuild: z.number().int(),
  deprecation: deprecationSchema.optional(),
}).meta({ id: "Meta" });

export const errorBodySchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  fields: z.array(fieldIssueSchema).optional(),
  retryAfterSeconds: z.number().int().optional(),
}).meta({ id: "ErrorBody" });

export const failureSchema = z.object({
  ok: z.literal(false),
  error: errorBodySchema,
  meta: metaSchema,
}).meta({ id: "Failure" });

// ---------------------------------------------------------------------------
// Domain DTOs
// ---------------------------------------------------------------------------

/**
 * The signed-in person's own profile.
 *
 * Note what is missing: no email, no phone, no People id, no church role. The
 * credential's email lives in the auth session the client already holds, and
 * everything else is either not the app's business or is deliberately gated
 * behind an explicit staff decision.
 */
export const visitorProfileSchema = z.object({
  displayName: z.string().nullable(),
  avatarUrl: url.nullable(),
  status: accountStatusSchema,
  termsVersion: z.string().nullable(),
  termsAcceptedAt: instant.nullable(),
  privacyVersion: z.string().nullable(),
  privacyAcceptedAt: instant.nullable(),
  autoAttendanceConsent: consentStateSchema,
  communicationPrefs: z.record(z.string(), z.boolean()),
  selectedChurchSlug: churchSlug.nullable(),
  /**
   * Increments whenever a cached authorization decision could have become
   * wrong. A client compares this against what it cached and drops affected
   * partitions on any change.
   */
  authorizationVersion: z.number().int(),
}).meta({ id: "VisitorProfile" });

export const appThemePaletteSchema = z.object({
  primary: z.string().regex(/^#[0-9A-F]{6}$/),
  accent: z.string().regex(/^#[0-9A-F]{6}$/),
  accentSoft: z.string().regex(/^#[0-9A-F]{6}$/),
  onAccent: z.string().regex(/^#[0-9A-F]{6}$/),
}).meta({ id: "AppThemePalette" });

export const churchAppThemeSchema = z.object({
  light: appThemePaletteSchema,
  dark: appThemePaletteSchema,
}).meta({ id: "ChurchAppTheme" });

export const churchThemeSettingsSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/).nullable(),
  accentColor: z.string().regex(/^#[0-9A-F]{6}$/).nullable(),
  appTheme: churchAppThemeSchema.nullable(),
}).meta({ id: "ChurchThemeSettings" });

export const updateChurchThemeRequestSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
}).meta({ id: "UpdateChurchThemeRequest" });

/** One church this account has a relationship with. */
export const churchRelationshipSchema = z.object({
  churchSlug,
  churchName: z.string(),
  logoUrl: url.nullable(),
  /** Accessible semantic colors selected by this church. Null uses FaithForm defaults. */
  appTheme: churchAppThemeSchema.nullable().optional(),
  /** Church admins may edit this church's appearance from the native app. */
  canManageBranding: z.boolean().optional(),
  /** Which member-facing check-in methods this church has switched on. */
  automaticCheckInEnabled: z.boolean().optional(),
  codeCheckInEnabled: z.boolean().optional(),
  /** This church offers Groups to its people. Older servers omit it. */
  groupsEnabled: z.boolean().optional(),
  state: relationshipStateSchema,
  joinPolicy: joinPolicySchema,
  joinedAt: instant.nullable(),
  updatedAt: instant,
  /** Whether this state currently permits reading what the church publishes. */
  canReadPublishedContent: z.boolean(),
}).meta({ id: "ChurchRelationship" });

export const accountRequestSchema = z.object({
  id: z.string(),
  kind: accountRequestKindSchema,
  status: accountRequestStatusSchema,
  requestedAt: instant,
  completedAt: instant.nullable(),
}).meta({ id: "AccountRequest" });

/**
 * Everything the app needs on launch, in one round trip.
 *
 * A first-time account with no churches is a normal, fully-valid response —
 * `relationships` is empty and `selectedChurchSlug` is null. The client must
 * render that state rather than treating it as an error.
 */
export const bootstrapSchema = z.object({
  profile: visitorProfileSchema,
  relationships: z.array(churchRelationshipSchema),
  pendingRequests: z.array(accountRequestSchema),
  /** Policy versions the client should present if the profile has not accepted them. */
  requiredTermsVersion: z.string(),
  requiredPrivacyVersion: z.string(),
  /** Which feature areas the server will actually serve for this build. */
  enabledCapabilities: z.array(z.string()),
  serverTime: instant,
}).meta({ id: "Bootstrap" });

export const relationshipPageSchema = z.object({
  items: z.array(churchRelationshipSchema),
  nextCursor: z.string().nullable(),
}).meta({ id: "RelationshipPage" });

export const selectedChurchSchema = z.object({
  selectedChurchSlug: churchSlug.nullable(),
  authorizationVersion: z.number().int(),
}).meta({ id: "SelectedChurch" });

export const signOutResultSchema = z.object({
  signedOut: z.literal(true),
  /** The client must purge every partition at or below this version. */
  authorizationVersion: z.number().int(),
}).meta({ id: "SignOutResult" });

/**
 * Non-secret runtime metadata. Deliberately contains no provider names, URLs,
 * project identifiers, or configuration values — only what a client needs to
 * decide whether it can talk to this server at all.
 */
export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  apiVersion: z.string(),
  apiMajor: z.number().int(),
  minimumSupportedClientBuild: z.number().int(),
  serverTime: instant,
}).meta({ id: "Health" });

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const updateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  communicationPrefs: z.record(z.string(), z.boolean()).optional(),
}).meta({ id: "UpdateProfileRequest" });

export const selectChurchRequestSchema = z.object({
  churchSlug: churchSlug.nullable(),
}).meta({ id: "SelectChurchRequest" });

export const consentRequestSchema = z.object({
  termsVersion: z.string().max(40).optional(),
  privacyVersion: z.string().max(40).optional(),
  autoAttendanceConsent: z.enum(["granted", "denied", "revoked"]).optional(),
}).meta({ id: "ConsentRequest" });

export const accountActionRequestSchema = z.object({
  kind: accountRequestKindSchema,
}).meta({ id: "AccountActionRequest" });


// ---------------------------------------------------------------------------
// Prompt 5 — discovery, onboarding, feed, notifications
// ---------------------------------------------------------------------------

export const announcementVisibilitySchema = z.enum(["public", "followers", "members"]);
export const notificationTopicSchema = z.enum(["announcements", "events"]);
export const devicePlatformSchema = z.enum(["ios", "android"]);

/** A church as it appears in search results. Public projection only. */
export const discoveredChurchSchema = z
  .object({
    slug: churchSlug,
    name: z.string(),
    logoUrl: url.nullable(),
    publicSummary: z.string().nullable(),
    denomination: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    joinPolicy: joinPolicySchema,
    publicProfileVersion: z.number().int(),
    /** Present only for a nearby search; rounded to 100 m. */
    distanceKm: z.number().nullable(),
    campusName: z.string().nullable(),
  })
  .meta({ id: "DiscoveredChurch" });

export const discoveryPageSchema = z
  .object({
    items: z.array(discoveredChurchSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "DiscoveryPage" });

export const publicCampusSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    addressLine1: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    timezone: z.string(),
    isPrimary: z.boolean(),
  })
  .meta({ id: "PublicCampus" });

export const publicServiceTimeSchema = z
  .object({
    campusSlug: z.string(),
    label: z.string(),
    dayOfWeek: z.number().int(),
    startTime: z.string(),
    kind: z.string(),
  })
  .meta({ id: "PublicServiceTime" });

/**
 * One of the church's social profiles.
 *
 * `platform` is a plain string rather than an enum so a platform added later
 * reaches older apps as a generic link instead of failing to decode. Today's
 * values: instagram, facebook, youtube, tiktok, x, podcast.
 */
export const churchSocialLinkSchema = z
  .object({
    platform: z.string().min(1).max(40),
    url,
  })
  .meta({ id: "ChurchSocialLink" });

/** A destination the church chose to feature — "Plan a visit", "Prayer requests". */
export const churchQuickLinkSchema = z
  .object({
    label: z.string().min(1).max(60),
    url,
  })
  .meta({ id: "ChurchQuickLink" });

/**
 * A church's page in the app: what someone reads before adding it, and the
 * church information screen afterwards.
 */
export const churchProfileSchema = z
  .object({
    slug: churchSlug,
    name: z.string(),
    logoUrl: url.nullable(),
    coverImageUrl: url.nullable(),
    publicSummary: z.string().nullable(),
    tagline: z.string().nullable(),
    denomination: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    website: url.nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    joinPolicy: joinPolicySchema,
    timezone: z.string(),
    publicProfileVersion: z.number().int(),
    campuses: z.array(publicCampusSchema),
    serviceTimes: z.array(publicServiceTimeSchema),
    /** The caller's own relationship, if any. Null when signed out. */
    relationshipState: relationshipStateSchema.nullable(),
    /** The longer "about us". Additive: older servers omit it. */
    about: z.string().nullable().optional(),
    /** A maps link the church chose, used ahead of a generated one. */
    mapsUrl: url.nullable().optional(),
    /** Ordered as the church wants them shown. Additive. */
    socialLinks: z.array(churchSocialLinkSchema).optional(),
    /** Ordered as the church wants them shown. Additive. */
    quickLinks: z.array(churchQuickLinkSchema).optional(),
  })
  .meta({ id: "ChurchProfile" });

/**
 * What the app should show right after authentication.
 *
 * `needsOnboarding` is computed server-side rather than inferred from an empty
 * relationship list, so the rule lives in one place.
 */
export const onboardingStateSchema = z
  .object({
    needsOnboarding: z.boolean(),
    hasAnyRelationship: z.boolean(),
    selectedChurchSlug: churchSlug.nullable(),
    activeChurchCount: z.number().int(),
    requiresChurchChooser: z.boolean(),
  })
  .meta({ id: "OnboardingState" });

/** One published announcement or event. */
export const feedItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    startAt: instant,
    endAt: instant.nullable(),
    /** Date-only calendar entry. Render in UTC without a clock time. */
    allDay: z.boolean(),
    location: z.string().nullable(),
    posterUrl: url.nullable(),
    posterAltText: z.string().nullable(),
    isPinned: z.boolean(),
    visibility: announcementVisibilitySchema,
    publicationVersion: z.number().int(),
    publishedAt: instant.nullable(),
    /** True when end_at is set — the client renders it as an event. */
    isEvent: z.boolean(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
  })
  .meta({ id: "FeedItem" });

export const feedPageSchema = z
  .object({
    items: z.array(feedItemSchema),
    nextCursor: z.string().nullable(),
    /** Drives the feed ETag; a change means refetch. */
    feedVersion: z.number().int(),
  })
  .meta({ id: "FeedPage" });

/** One month of published events for the Home Schedule pane. */
export const schedulePageSchema = z
  .object({
    items: z.array(feedItemSchema),
    /** Drives the schedule ETag; a change means refetch. */
    scheduleVersion: z.number().int(),
  })
  .meta({ id: "SchedulePage" });

export const notificationPreferenceSchema = z
  .object({
    churchSlug,
    topic: notificationTopicSchema,
    isEnabled: z.boolean(),
  })
  .meta({ id: "NotificationPreference" });

export const deviceInstallationSchema = z
  .object({
    installId: z.string(),
    platform: devicePlatformSchema,
    isEnabled: z.boolean(),
    lastSeenAt: instant,
  })
  .meta({ id: "DeviceInstallation" });

/**
 * The church behind an invitation, resolved *before* sign-in so the account
 * screens can name it. Deliberately three fields: enough to say "Join Grace
 * Community" over the right logo, and nothing a stranger holding a stolen link
 * could mine — no address, no contact details, no join policy.
 */
export const invitationPreviewSchema = z
  .object({
    churchSlug,
    churchName: z.string(),
    logoUrl: z.string().nullable(),
  })
  .meta({ id: "InvitationPreview" });

// --- requests ---

export const followRequestSchema = z
  .object({ churchSlug })
  .meta({ id: "FollowRequest" });

export const acceptInvitationRequestSchema = z
  .object({ token: z.string().min(16).max(512) })
  .meta({ id: "AcceptInvitationRequest" });

export const invitationPreviewRequestSchema = z
  .object({ token: z.string().min(16).max(512) })
  .meta({ id: "InvitationPreviewRequest" });

export const registerDeviceRequestSchema = z
  .object({
    installId: z.string().min(8).max(128),
    platform: devicePlatformSchema,
    provider: z.enum(["apns", "fcm"]),
    providerToken: z.string().min(16).max(4096),
    appVersion: z.string().max(40).optional(),
    clientBuild: z.number().int().optional(),
    osVersion: z.string().max(40).optional(),
    locale: z.string().max(20).optional(),
  })
  .meta({ id: "RegisterDeviceRequest" });

export const setPreferenceRequestSchema = z
  .object({
    churchSlug,
    topic: notificationTopicSchema,
    isEnabled: z.boolean(),
  })
  .meta({ id: "SetPreferenceRequest" });


// ---------------------------------------------------------------------------
// Prompt 6 — attendance
// ---------------------------------------------------------------------------

export const attendanceSourceSchema = z.enum(["manual", "admin", "geofence", "qr", "kiosk"]);
export const attendanceOutcomeSchema = z.enum([
  "counted", "already_counted", "pending_confirmation", "rejected", "reversed",
]);

/**
 * The occurrence a check-in would land on right now.
 *
 * Resolved server-side from the clock and the caller's church. A client never
 * names an occurrence, so it cannot check into a service it is not at.
 */
export const eligibleOccurrenceSchema = z
  .object({
    occurrenceId: z.string(),
    label: z.string(),
    churchSlug,
    campusName: z.string().nullable(),
    localServiceDate: z.string(),
    timezone: z.string(),
    startsAt: instant,
    endsAt: instant,
    checkinOpensAt: instant,
    checkinClosesAt: instant,
    status: z.enum(["scheduled", "active", "completed", "cancelled"]),
  })
  .meta({ id: "EligibleOccurrence" });

/**
 * What the account may do at this occurrence, and what the campus expects.
 *
 * Deliberately excludes anything that would help someone fake presence: no
 * campus coordinates, no radius. The client reports what it observed; the
 * server decides whether that counts.
 */
export const attendanceCapabilitySchema = z
  .object({
    occurrenceId: z.string(),
    geofenceEnabled: z.boolean(),
    qrEnabled: z.boolean(),
    manualEnabled: z.boolean(),
    requiresConfirmation: z.boolean(),
    minDwellSeconds: z.number().int(),
    maxLocationAccuracyM: z.number().int(),
    hasVerifiedPeopleLink: z.boolean(),
    autoAttendanceConsent: consentStateSchema,
    /** True only when every precondition is already satisfied. */
    canAttemptAutomatically: z.boolean(),
  })
  .meta({ id: "AttendanceCapability" });

export const attendanceResultSchema = z
  .object({
    outcome: attendanceOutcomeSchema,
    /** A safe, human-readable line. Never says why a location attempt failed. */
    message: z.string(),
    occurrenceId: z.string().nullable(),
    countedAt: instant.nullable(),
    /**
     * The earliest instant a `confirm` submission can succeed.
     *
     * Present only on `pending_confirmation`, and **measured by the server's
     * own clock**: `detected_at_server + minDwellSeconds`, from the
     * occurrence's snapshot. An earlier version derived it from the client's
     * `observedAt`, which meant backdating that value produced a deadline
     * already in the past.
     *
     * This is **scheduling information, not authority**. The client uses it to
     * decide when it is worth trying; the server enforces the same rule again
     * from two of its own timestamps, so a device clock days out changes
     * nothing.
     */
    confirmationNotBefore: instant.nullable().optional(),
    /**
     * The server-issued detection to present on `confirm`.
     *
     * Opaque. Present only on `pending_confirmation`, bound to the account,
     * member, church, occurrence, region, configuration version and logical
     * attempt that opened it.
     */
    detectionId: z.string().nullable().optional(),
  })
  .meta({ id: "AttendanceResult" });

export const attendanceStatusSchema = z
  .object({
    occurrenceId: z.string(),
    isCounted: z.boolean(),
    status: z.enum(["active", "reversed"]).nullable(),
    source: attendanceSourceSchema.nullable(),
    countedAt: instant.nullable(),
  })
  .meta({ id: "AttendanceStatus" });

export const attendanceHistoryItemSchema = z
  .object({
    occurrenceId: z.string(),
    label: z.string(),
    localServiceDate: z.string(),
    campusName: z.string().nullable(),
    source: attendanceSourceSchema,
    status: z.enum(["active", "reversed"]),
    countedAt: instant,
  })
  .meta({ id: "AttendanceHistoryItem" });

export const attendanceHistoryPageSchema = z
  .object({
    items: z.array(attendanceHistoryItemSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "AttendanceHistoryPage" });

// --- requests ---

/**
 * An attendance attempt.
 *
 * Notice what a client may *not* send: a member id, a church id, a counted
 * result, or a distance. It reports an observation; the server resolves who it
 * is for and decides what it means.
 */
export const attendanceAttemptRequestSchema = z
  .object({
    /**
     * Which service this is for.
     *
     * Required for a `geofence` attempt and **ignored for a `qr` one**: a
     * scanner cannot know which service it is pointed at, so the occurrence is
     * read out of the signed token or the short code's own row. Optional rather
     * than removed, because a client built before Prompt 8 still sends it and
     * must still validate.
     */
    occurrenceId: z.string().optional(),
    source: z.enum(["geofence", "qr"]),
    /** `detected` starts the dwell clock; `confirm` completes it. */
    phase: z.enum(["detected", "confirm"]).default("confirm"),
    observedAt: instant.optional(),
    accuracyMeters: z.number().optional(),
    dwellSeconds: z.number().int().optional(),
    /**
     * Where the device believed it was, for a `geofence` attempt.
     *
     * Additive and optional, so a client built before Prompt 7 still validates.
     * These are **inputs to a server-side computation, not a claim the server
     * accepts**: the distance band is derived here, against the campus position
     * the occurrence snapshotted, and the coordinates are then discarded. A
     * geofence attempt that omits them bands as `unknown` and is refused —
     * failing closed rather than being assumed present.
     *
     * A client still cannot send a distance, a band, or a result.
     */
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    /**
     * Whether the platform reported the position as coming from a mock
     * provider (Android `Location.isFromMockProvider`). Recorded as one signal
     * among several and **never** the sole decision rule; iOS exposes no
     * equivalent and none is invented for it.
     */
    mockLocationReported: z.boolean().optional(),
    /**
     * The client's logical attempt id, sent on `detected`.
     *
     * Makes the server-side detection idempotent per workflow: a retried
     * `detected` returns the same detection and the **same timestamps** rather
     * than restarting the dwell clock.
     */
    attemptId: z.string().max(64).optional(),
    /**
     * The server-issued detection this confirms, sent on `confirm`.
     *
     * Opaque to the client. The server re-reads the row, re-checks every
     * binding, and measures the elapsed dwell from its own clock — so nothing
     * the device reports can shorten it.
     */
    detectionId: z.string().max(64).optional(),
    /** The region the device reported, bound at detection and re-checked. */
    regionId: z.string().max(200).optional(),
    /** The configuration version the client held. A change invalidates. */
    configVersion: z.number().int().optional(),
    /**
     * A scanned rotating code.
     *
     * Opaque to the client — it is signed by the server and the client holds no
     * key to read or forge one. Bounded so a pathological payload is refused by
     * the schema rather than by the parser.
     */
    qrToken: z.string().max(1024).optional(),
    /**
     * The typed alternative to `qrToken`, for anyone who cannot use a camera.
     *
     * Seven characters from an alphabet with every confusable pair removed,
     * normalised server-side, and **rate limited hard**: it resolves to exactly
     * the same session as the QR beside it on the screen, with the same expiry.
     * Longer than a code so a formatted `BCD-4G7J` and a pasted one both fit.
     */
    shortCode: z.string().max(32).optional(),
    /**
     * A fresh random identity for one scan.
     *
     * The `Idempotency-Key` header is still what makes a retry idempotent; this
     * exists so the audit can tell one scan from the next, and to make the
     * client rule explicit: **a new tap on "Scan" is a new attempt.** Prompt 7
     * learned this the hard way on the geofence path, where deriving the key
     * from stable inputs made one early refusal permanent for the whole service.
     */
    scanAttemptId: z.string().max(64).optional(),
  })
  .meta({ id: "AttendanceAttemptRequest" });

export const attendanceConsentRequestSchema = z
  .object({ autoAttendanceConsent: z.enum(["granted", "denied", "revoked"]) })
  .meta({ id: "AttendanceConsentRequest" });

/**
 * What the server now holds, and the version to re-partition against.
 *
 * Consent is server state, entirely separate from an operating-system location
 * permission. Both are required for automatic attendance and neither implies
 * the other, so the client stores this answer rather than inferring it from
 * whatever the OS last reported.
 */
export const attendanceConsentResultSchema = z
  .object({
    autoAttendanceConsent: consentStateSchema,
    /** Bumped on every change, so a withdrawal invalidates cached decisions. */
    authorizationVersion: z.number().int(),
  })
  .meta({ id: "AttendanceConsentResult" });


/**
 * One OS-monitorable region.
 *
 * The centre and radius are returned because Core Location and
 * `GeofencingClient` cannot register a region without them. Withholding them
 * would not be a security control — a church's address is public, and this
 * codebase already serves it in the discovery projection. The security is
 * server-side validation of what the device later submits.
 */
export const geofenceRegionSchema = z
  .object({
    regionId: z.string(),
    campusName: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    radiusMeters: z.number().int(),
  })
  .meta({ id: "GeofenceRegion" });

export const geofenceWindowSchema = z
  .object({
    occurrenceId: z.string(),
    label: z.string(),
    startsAt: instant,
    endsAt: instant,
    checkinOpensAt: instant,
    checkinClosesAt: instant,
    timezone: z.string(),
  })
  .meta({ id: "GeofenceWindow" });

export const attendanceSourceAvailabilitySchema = z
  .object({
    geofence: z.boolean(),
    qr: z.boolean(),
    manual: z.boolean(),
  })
  .meta({ id: "AttendanceSourceAvailability" });

/**
 * Everything a native client needs to register regions, and nothing else.
 *
 * Absent by construction: other churches, staff data, People records, internal
 * validation thresholds, and any provider credential.
 */
export const geofenceConfigurationSchema = z
  .object({
    churchSlug,
    regions: z.array(geofenceRegionSchema),
    windows: z.array(geofenceWindowSchema),
    sources: attendanceSourceAvailabilitySchema,
    requiresConfirmation: z.boolean(),
    minDwellSeconds: z.number().int(),
    maxLocationAccuracyM: z.number().int(),
    /**
     * Which configuration this is. Changes on policy edit, revocation, or
     * consent withdrawal — it folds in the account's authorization version.
     * An identity, not a credential.
     */
    configVersion: z.number().int(),
    /**
     * After this the client must revalidate or tear its regions down.
     *
     * **Deterministic within an epoch-aligned time bucket and the current
     * attendance-window state.** `now` selects the bucket, so this is not
     * independent of `now`; what it does not do is change on every request. It
     * moves only at predictable boundaries — a 15-minute bucket edge or a
     * check-in window edge — which is what lets the ETag cover it. A client
     * revalidating an expired configuration therefore always receives a fresh
     * response or a refusal, never a 304.
     */
    expiresAt: instant,
  })
  .meta({ id: "GeofenceConfiguration" });

/** Null configuration plus a typed reason, so the client knows what to show. */
export const geofenceConfigResponseSchema = z
  .object({
    configuration: geofenceConfigurationSchema.nullable(),
    refusalReason: z
      .enum([
        "not_enrolled",
        "no_people_link",
        "consent_required",
        "geofence_disabled",
        "no_campus_configured",
      ])
      .nullable(),
    message: z.string().nullable(),
  })
  .meta({ id: "GeofenceConfigResponse" });

// ---------------------------------------------------------------------------
// Registry — what the generator walks
// ---------------------------------------------------------------------------

/**
 * Order matters: it fixes the order of generated declarations, which is what
 * makes regeneration byte-stable and therefore diffable in CI.
 */
// ---------------------------------------------------------------------------
// Prompt 9 — published media
// ---------------------------------------------------------------------------

export const mediaKindSchema = z.enum(["live", "recording"]);

/**
 * How the bytes actually arrive.
 *
 * Distinct from `kind`, which says *what* is being watched. A live service is
 * always HLS; the archive is progressive today because the relay writes one MP4
 * per service and nothing packages a VOD playlist. If that ever changes, a
 * recording becomes `hls` and the players need to know without a new contract
 * version — which is why this is a field rather than an inference from `kind`.
 *
 * It is also the only part of the eligibility model a visitor's app is told.
 * **The reasons a recording is ineligible are staff-facing and never reach a
 * device**: an ineligible recording is simply absent from a visitor's list, and
 * `tests/security/media-privacy.test.ts` asserts no visitor DTO carries a
 * container, a codec, or a refusal reason.
 */
export const mediaRenditionKindSchema = z.enum(["hls", "progressive"]);
export const liveMediaStateSchema = z.enum(["live", "upcoming", "recent_ended"]);

/**
 * What a church is showing right now.
 *
 * The whole object is nullable at the response level rather than carrying an
 * `isLive: false`: a home screen must not render a frame around nothing, and an
 * absent object is much harder to accidentally draw than a falsy flag.
 */
export const linkedPresentationSchema = z.object({
  presentationId: z.string(),
  sermonId: z.string(),
  title: z.string(),
}).meta({ id: "LinkedPresentation" });

export const linkedServiceSchema = z.object({
  mediaId: z.string(),
  kind: mediaKindSchema,
  title: z.string(),
  startsAt: instant,
  posterUrl: z.string().nullable(),
}).meta({ id: "LinkedService" });

export const liveMediaSchema = z
  .object({
    presentation: linkedPresentationSchema.nullable().optional(),
    state: liveMediaStateSchema,
    /** Opaque. A `stream_events` id, but the client never needs to know that. */
    mediaId: z.string(),
    kind: z.literal("live"),
    title: z.string(),
    startsAt: instant,
    countdownEnabled: z.boolean(),
    posterUrl: z.string().nullable(),
    publicationVersion: z.number().int(),
    churchSlug,
    churchName: z.string(),
    /** The church's zone. "Sunday 10am" means the church's Sunday. */
    churchTimezone: z.string(),
    /**
     * The same service, watchable again: the id of its published recording
     * (an archive `mediaId`), present only on a `recent_ended` card and only
     * once the recording is published to this visitor. Lets "Today's service
     * has ended" become "Watch the replay" without a second list lookup — and
     * without the live service and its replay looking like two unrelated items.
     */
    replayMediaId: z.string().nullable().optional(),
  })
  .meta({ id: "LiveMedia" });

export const liveMediaResponseSchema = z
  .object({
    live: liveMediaSchema.nullable(),
    mediaVersion: z.number().int(),
  })
  .meta({ id: "LiveMediaResponse" });

/**
 * One published recording, as it appears in a list.
 *
 * Deliberately absent: the storage path, the provider URL, the internal
 * recording status, the trim values, the visibility that produced it, and the
 * view counts. A card needs a poster, a title, a date and a length.
 */
export const archiveItemSchema = z
  .object({
    mediaId: z.string(),
    kind: z.literal("recording"),
    title: z.string(),
    summary: z.string().nullable(),
    publishedAt: instant,
    /** When the service happened, which is what a person recognises it by. */
    recordedAt: instant,
    durationSeconds: z.number().int().nullable(),
    posterUrl: z.string().nullable(),
    seriesName: z.string().nullable(),
    speakers: z.array(z.string()),
    publicationVersion: z.number().int(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
  })
  .meta({ id: "ArchiveItem" });

export const mediaPageSchema = z
  .object({
    items: z.array(archiveItemSchema),
    nextCursor: z.string().nullable(),
    mediaVersion: z.number().int(),
  })
  .meta({ id: "MediaPage" });

export const mediaDetailSchema = z
  .object({
    presentation: linkedPresentationSchema.nullable().optional(),
    mediaId: z.string(),
    kind: z.literal("recording"),
    title: z.string(),
    summary: z.string().nullable(),
    publishedAt: instant,
    recordedAt: instant,
    durationSeconds: z.number().int().nullable(),
    /**
     * Where the trimmed recording starts inside the stored file.
     *
     * The client seeks here on open, and treats it as position zero for resume.
     * Without it a trimmed service would begin on the empty room before anyone
     * arrived.
     */
    startOffsetSeconds: z.number().int(),
    posterUrl: z.string().nullable(),
    seriesName: z.string().nullable(),
    speakers: z.array(z.string()),
    chapters: z.array(z.string()),
    topics: z.array(z.string()),
    publicationVersion: z.number().int(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
  })
  .meta({ id: "MediaDetail" });

export const presentationThemeFieldsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    backgroundType: z.enum(["solid", "image"]),
    bg: z.string().nullable(),
    bgCss: z.string(),
    text: z.string(),
    accent: z.string(),
    fontHead: z.string(),
    fontBody: z.string(),
    italicRef: z.boolean(),
    textShadow: z.boolean(),
    imageUrl: z.string().nullable(),
  })
  .meta({ id: "PresentationTheme" });

/**
 * One sermon in the archive list.
 *
 * A deliberately narrow projection of a much larger row. The Sermon Builder
 * stores a manuscript, the preacher's style notes, the audience they aimed at
 * and the model that drafted it — none of which appears here or in the detail
 * below, because none of it is written for a congregation to read.
 */
export const sermonListItemSchema = z
  .object({
    sermonId: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    publishedAt: instant,
    /** The day it was preached (YYYY-MM-DD), when the church recorded one. */
    preachedOn: z.string().nullable(),
    scriptureRefs: z.array(z.string()),
    seriesName: z.string().nullable(),
    publicationVersion: z.number().int(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
    theme: presentationThemeFieldsSchema.nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
  })
  .meta({ id: "SermonListItem" });

export const sermonPageSchema = z
  .object({
    items: z.array(sermonListItemSchema),
    nextCursor: z.string().nullable(),
    sermonVersion: z.number().int(),
  })
  .meta({ id: "SermonPage" });

/** One main point of a sermon: a heading, what it said, where it came from. */
export const sermonPointSchema = z
  .object({
    title: z.string(),
    summary: z.string(),
    scripture: z.string().nullable(),
  })
  .meta({ id: "SermonPoint" });

export const sermonOutlineSchema = z
  .object({
    intro: z.string().nullable(),
    points: z.array(sermonPointSchema),
    application: z.string().nullable(),
    closing: z.string().nullable(),
  })
  .meta({ id: "SermonOutline" });

/**
 * A discussion question. `category` is free text rather than an enum: an older
 * asset may carry a category this build has never heard of, and a small group
 * losing its questions because a label was unrecognised would be absurd.
 */
export const sermonQuestionSchema = z
  .object({
    category: z.string(),
    question: z.string(),
  })
  .meta({ id: "SermonQuestion" });

export const sermonDetailSchema = z
  .object({
    linkedServices: z.array(linkedServiceSchema).optional(),
    sermonId: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    publishedAt: instant,
    preachedOn: z.string().nullable(),
    scriptureRefs: z.array(z.string()),
    seriesName: z.string().nullable(),
    publicationVersion: z.number().int(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
    /** Null when a sermon was published with no outline worth showing. */
    outline: sermonOutlineSchema.nullable(),
    discussionQuestions: z.array(sermonQuestionSchema),
  })
  .meta({ id: "SermonDetail" });

/**
 * Published sermon presentation archive (AD-008 / Prompt 10).
 *
 * Semantic slide pages only — never the live manuscript. Image/PDF renditions
 * are optional and may be empty while native apps render text from `pages`.
 */
export const presentationPageKindSchema = z.enum([
  "title",
  "scripture",
  "point",
  "application",
  "closing",
]);

export const presentationPageSchema = z
  .object({
    id: z.string(),
    kind: presentationPageKindSchema,
    title: z.string().optional(),
    body: z.string().optional(),
    scripture: z.string().optional(),
    readingOrder: z.array(z.string()),
  })
  .meta({ id: "PresentationPage" });

export const presentationListItemSchema = z
  .object({
    presentationId: z.string(),
    sermonId: z.string(),
    version: z.number().int(),
    title: z.string(),
    publishedAt: instant,
    pageCount: z.number().int(),
    contentHash: z.string(),
    scriptureRefs: z.array(z.string()),
    seriesName: z.string().nullable(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
    theme: presentationThemeFieldsSchema.nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
  })
  .meta({ id: "PresentationListItem" });

export const presentationPageResponseSchema = z
  .object({
    items: z.array(presentationListItemSchema),
    nextCursor: z.string().nullable(),
    presentationVersion: z.number().int(),
  })
  .meta({ id: "PresentationPageResponse" });

export const presentationSlideRenditionSchema = z
  .object({
    pageId: z.string(),
    imagePath: z.string().optional(),
    imageUrl: z.string().optional(),
  })
  .meta({ id: "PresentationSlideRendition" });

export const presentationRenditionsSchema = z
  .object({
    slides: z.array(presentationSlideRenditionSchema),
    pdfPath: z.string().optional(),
  })
  .meta({ id: "PresentationRenditions" });

export const presentationDetailSchema = z
  .object({
    linkedServices: z.array(linkedServiceSchema).optional(),
    presentationId: z.string(),
    sermonId: z.string(),
    version: z.number().int(),
    title: z.string(),
    publishedAt: instant,
    pageCount: z.number().int(),
    contentHash: z.string(),
    scriptureRefs: z.array(z.string()),
    seriesName: z.string().nullable(),
    churchSlug,
    churchName: z.string(),
    churchTimezone: z.string(),
    pages: z.array(presentationPageSchema),
    theme: presentationThemeFieldsSchema.nullable(),
    renditions: presentationRenditionsSchema,
  })
  .meta({ id: "PresentationDetail" });

/**
 * Permission to watch one thing, for a few minutes.
 *
 * `deliveryUrl` carries **no** credential. The capability travels in an
 * `Authorization: Bearer` header on every request the player makes, including
 * each segment — which is why both platforms are wired through header-capable
 * loaders rather than being handed a signed URL.
 */
export const playbackGrantSchema = z
  .object({
    capability: z.string(),
    expiresAt: instant,
    deliveryUrl: z.string(),
    kind: mediaKindSchema,
    /**
     * The delivery form this URL will serve.
     *
     * A player configures itself from this rather than guessing from the path,
     * and a mismatch between what the server serves and what the player expects
     * becomes a contract change rather than a silent failure.
     */
    renditionKind: mediaRenditionKindSchema,
    mediaId: z.string(),
    /**
     * How long before expiry to refresh. The client refreshes on this rather
     * than on failure, so a capability never dies mid-segment.
     */
    refreshAfterSeconds: z.number().int(),
    startOffsetSeconds: z.number().int(),
  })
  .meta({ id: "PlaybackGrant" });

export const playbackGrantRequestSchema = z
  .object({
    churchSlug,
    kind: mediaKindSchema,
    mediaId: z.string().max(64),
  })
  .meta({ id: "PlaybackGrantRequest" });

// ---------------------------------------------------------------------------
// Giving (Prompt 11)
// ---------------------------------------------------------------------------

/**
 * Whether a church can be given to, right now.
 *
 * `notAccepting` covers an incomplete Stripe onboarding, a disabled capability
 * and a church that switched giving off. One value on purpose: a visitor does
 * not need to know which, and a church would not want an app announcing it.
 */
export const givingAvailabilitySchema = z.enum(["available", "not_accepting", "not_found"]);

/**
 * The state of one logical donation attempt.
 *
 * `succeeded`, `refunded` and `disputed` are only ever written by the Stripe
 * webhook. A payment sheet finishing moves nothing here.
 */
export const donationStatusSchema = z.enum([
  "initiated",
  "requires_action",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
  "disputed",
]);

export const givingFundSchema = z
  .object({
    fundId: z.string().max(64),
    title: z.string().max(120),
    description: z.string().max(600).nullable(),
    /** Chips, in cents, ascending. A convenience — never a floor. */
    suggestedAmounts: z.array(z.number().int()).max(6),
    minAmountCents: z.number().int(),
    maxAmountCents: z.number().int(),
    currency: z.string().max(8),
    publicationVersion: z.number().int(),
  })
  .meta({ id: "GivingFund" });

export const givingHomeSchema = z
  .object({
    availability: givingAvailabilitySchema,
    churchName: z.string().max(200).nullable(),
    funds: z.array(givingFundSchema),
    /**
     * Whether this church runs recurring gifts at all.
     *
     * FaithForm gives one-time. This exists so the app can say where recurring
     * lives rather than pretending it does not exist.
     */
    recurringAvailable: z.boolean(),
    givingVersion: z.number().int(),
    /**
     * Whether the iPhone app may take this church's gifts with Apple Pay inside
     * the app.
     *
     * Apple allows an in-app donation without In-App Purchase only when it is
     * paid with Apple Pay and the receiving nonprofit is Apple-approved
     * (guideline 3.2.1(vi)). The recipient is the church, so this is per church
     * and set by FaithForm after verifying its Candid Seal. When false, iPhone
     * opens `webGiveUrl` in Safari instead of showing a payment sheet. Android
     * has no such rule and may ignore it. Always false unless `available`.
     */
    applePayApproved: z.boolean(),
    /**
     * The church's public web give page, absolute. Opened in the system browser
     * — never an in-app web view. Null unless `availability` is `available`.
     */
    webGiveUrl: url.nullable(),
  })
  .meta({ id: "GivingHome" });

/**
 * What a client sends to start, or resume, a donation.
 *
 * Three fields, and every one is checked against the church's own rows before
 * it is used. The church, the connected account, the currency, the metadata and
 * the platform's own amount bounds are **not here**, because a client does not
 * get to choose them.
 */
export const startDonationRequestSchema = z
  .object({
    churchSlug: z.string().min(1).max(120),
    fundId: z.string().max(64),
    amountCents: z.number().int(),
    /**
     * The client's id for this logical attempt.
     *
     * Its entire job is to **repeat**. The same value after an app kill, a lost
     * network or a double tap returns the same payment intent rather than
     * creating a second charge.
     */
    clientAttemptId: z.string().min(8).max(64),
  })
  .meta({ id: "StartDonationRequest" });

/**
 * Everything a native payment sheet needs, and nothing else.
 *
 * `stripeAccountId` is an account *identifier*, required by both platforms' SDKs
 * to charge a connected account directly. It is not a credential and authorises
 * nothing on its own.
 */
export const donationSessionSchema = z
  .object({
    attemptId: z.string().max(64),
    status: donationStatusSchema,
    clientSecret: z.string().max(512),
    publishableKey: z.string().max(255),
    stripeAccountId: z.string().max(64),
    merchantName: z.string().max(200),
    amountCents: z.number().int(),
    currency: z.string().max(8),
    fundTitle: z.string().max(120),
  })
  .meta({ id: "DonationSession" });

export const donationStatusResultSchema = z
  .object({
    attemptId: z.string().max(64),
    status: donationStatusSchema,
    amountCents: z.number().int(),
    currency: z.string().max(8),
    fundTitle: z.string().max(120),
    /**
     * Whether the **server** has heard from the webhook.
     *
     * A receipt is shown only when this is true. It is the single field that
     * separates "the sheet closed" from "the gift happened".
     */
    confirmed: z.boolean(),
    occurredAt: z.string().max(40),
  })
  .meta({ id: "DonationStatusResult" });

export const givingHistoryPageSchema = z
  .object({
    items: z.array(donationStatusResultSchema),
    nextCursor: z.string().max(255).nullable(),
  })
  .meta({ id: "GivingHistoryPage" });

/**
 * A receipt.
 *
 * Exists only for a webhook-confirmed succeeded gift. Carries no donor email,
 * no Stripe identifier, no fee, no net amount, and **no tax language**: nothing
 * in the dashboard records deductibility, so the word is "receipt".
 */
export const givingReceiptSchema = z
  .object({
    attemptId: z.string().max(64),
    amountCents: z.number().int(),
    currency: z.string().max(8),
    fundTitle: z.string().max(120),
    churchName: z.string().max(200),
    paidAt: z.string().max(40),
    giftType: z.enum(["one_time", "recurring"]),
  })
  .meta({ id: "GivingReceipt" });

// ---------------------------------------------------------------------------
// Prompt 14 — groups and messaging
// ---------------------------------------------------------------------------
//
// Groups are addressed by their uuid (already a public handle, like a feed
// item's id) inside a church addressed by its slug. Nothing here names a
// People record, a staff role, an account, a church uuid, or a provider
// secret. Enumerated values travel as strings and are decoded with each
// platform's forward-compatible `fromWire`/`init(rawValue:)`, so a value
// added later reaches a released app as "unknown" rather than a decode error.
//
// Chat identity: `chatUserId` is the opaque chat-provider id of a person —
// what a message's author is called in the conversation itself — never a
// FaithForm id. `userToken` is that person's own short-lived chat credential,
// issued to them alone; `appKey` is the provider's public app key.

export const groupTypeSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().max(60),
    /** A key each platform maps to its own icon set. */
    icon: z.string().max(40),
  })
  .meta({ id: "GroupTypeSummary" });

export const groupLeaderSchema = z
  .object({
    name: z.string().max(120),
    avatarUrl: url.nullable(),
    /** `leader` — managers are not listed as leaders. */
    groupRole: z.string().max(20),
    chatUserId: z.string().max(40).nullable(),
  })
  .meta({ id: "GroupLeader" });

export const groupEventSummarySchema = z
  .object({
    id: z.string(),
    groupId: z.string(),
    title: z.string().max(120),
    startsAt: instant,
    endsAt: instant,
    timezone: z.string().max(64),
    locationName: z.string().max(200).nullable(),
    isCancelled: z.boolean(),
    /** The caller's own answer: going, maybe, not_going. */
    rsvp: z.string().max(20).nullable(),
    goingCount: z.number().int(),
  })
  .meta({ id: "GroupEventSummary" });

/**
 * Where a group's conversation lives, for its members only. `state` is
 * `ready`, `read_only` (archived, paused, or messaging turned off) or
 * `unavailable` (not provisioned yet, or chat not configured).
 */
export const groupChatInfoSchema = z
  .object({
    cid: z.string().max(80),
    channelType: z.string().max(20),
    channelId: z.string().max(64),
    state: z.string().max(20),
    /** `everyone`, or `leaders` for an announcements-style group. */
    postingPolicy: z.string().max(20),
  })
  .meta({ id: "GroupChatInfo" });

export const groupSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().max(80),
    /** At most 280 characters; the detail carries the whole description. */
    summary: z.string().max(300).nullable(),
    coverImageUrl: url.nullable(),
    type: groupTypeSummarySchema.nullable(),
    memberCount: z.number().int(),
    capacity: z.number().int().nullable(),
    enrollment: z.string().max(30),
    visibility: z.string().max(20),
    status: z.string().max(20),
    /** "Every Tuesday at 7:00 PM". Null when the group has no schedule. */
    scheduleText: z.string().max(120).nullable(),
    /** 0 = Sunday. */
    meetingDays: z.array(z.number().int()),
    campusName: z.string().max(120).nullable(),
    /** Only when the church chose to show where the group meets publicly. */
    locationName: z.string().max(200).nullable(),
    nextEvent: groupEventSummarySchema.nullable(),
    /** member, requested, invited, not_member, banned. */
    membershipState: z.string().max(20),
    /** member, leader, manager — present only for members. */
    groupRole: z.string().max(20).nullable(),
    /** The one action the group page offers (see lib/groups/permissions.ts). */
    joinAction: z.string().max(30),
    chat: groupChatInfoSchema.nullable(),
    isYouth: z.boolean(),
    version: z.number().int(),
  })
  .meta({ id: "GroupSummary" });

export const myGroupsSchema = z
  .object({
    items: z.array(groupSummarySchema),
    /** Direct messages are allowed at this church, for this person. */
    directMessagesEnabled: z.boolean(),
    /** Chat is configured and switched on for this church. */
    messagingAvailable: z.boolean(),
  })
  .meta({ id: "MyGroups" });

export const groupDiscoveryPageSchema = z
  .object({
    items: z.array(groupSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "GroupDiscoveryPage" });

export const groupCampusOptionSchema = z
  .object({ id: z.string(), name: z.string().max(120) })
  .meta({ id: "GroupCampusOption" });

export const groupFiltersSchema = z
  .object({
    types: z.array(groupTypeSummarySchema),
    campuses: z.array(groupCampusOptionSchema),
    /** Weekdays some listed group meets on, 0 = Sunday. */
    days: z.array(z.number().int()),
  })
  .meta({ id: "GroupFilters" });

export const groupCapabilitiesSchema = z
  .object({
    canViewMembers: z.boolean(),
    canManageMembers: z.boolean(),
    canManageRequests: z.boolean(),
    canInvite: z.boolean(),
    canManageRoles: z.boolean(),
    canEditDetails: z.boolean(),
    canManageEvents: z.boolean(),
    canTakeAttendance: z.boolean(),
    canModerateChat: z.boolean(),
  })
  .meta({ id: "GroupCapabilities" });

export const groupScheduleSchema = z
  .object({
    text: z.string().max(120),
    frequency: z.string().max(20),
    dayOfWeek: z.number().int(),
    startTime: z.string().max(5),
    durationMinutes: z.number().int(),
    timezone: z.string().max(64),
  })
  .meta({ id: "GroupSchedule" });

/** Where a group meets. The address and link are for members unless public. */
export const groupLocationSchema = z
  .object({
    name: z.string().max(200).nullable(),
    address: z.string().max(500).nullable(),
    onlineMeetingUrl: url.nullable(),
    /** True when the church withholds the address from non-members. */
    membersOnly: z.boolean(),
  })
  .meta({ id: "GroupLocation" });

export const groupDetailSchema = z
  .object({
    group: groupSummarySchema,
    description: z.string().max(4000).nullable(),
    leaders: z.array(groupLeaderSchema),
    schedules: z.array(groupScheduleSchema),
    location: groupLocationSchema.nullable(),
    upcomingEvents: z.array(groupEventSummarySchema),
    capabilities: groupCapabilitiesSchema,
    /** Leaders only; zero for everyone else. */
    pendingRequestCount: z.number().int(),
    /** The member's own choice for this group: default, all, mentions, muted. */
    notificationLevel: z.string().max(20).nullable(),
    isArchived: z.boolean(),
    chatPosting: z.enum(["everyone", "leaders"]).optional(),
    memberListVisibility: z.enum(["members", "leaders"]).optional(),
  })
  .meta({ id: "GroupDetail" });

export const joinGroupRequestSchema = z
  .object({ message: z.string().trim().max(500).optional() })
  .meta({ id: "JoinGroupRequest" });

/**
 * A manager's edit of their own group. Visibility, the youth safety profile
 * and the category stay with church staff, who answer for them. The edit is
 * refused with `conflict` when `expectedVersion` is no longer current.
 */
export const updateGroupDetailsRequestSchema = z
  .object({
    expectedVersion: z.number().int(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(4000).nullable(),
    enrollment: z.enum(["open", "approval_required", "invitation_only", "closed"]),
    capacity: z.number().int().min(1).max(5000).nullable(),
    locationName: z.string().trim().max(200).nullable(),
    locationAddress: z.string().trim().max(500).nullable(),
    onlineMeetingUrl: z.string().trim().max(2048).nullable(),
    chatPosting: z.enum(["everyone", "leaders"]),
    memberListVisibility: z.enum(["members", "leaders"]),
  })
  .meta({ id: "UpdateGroupDetailsRequest" });

/**
 * What happened, and the page's new state. `outcome` is one of: joined,
 * already_member, requested, already_requested, left, request_cancelled,
 * full, closed, invitation_required, invitation_invalid, banned, not_found.
 */
export const groupJoinResultSchema = z
  .object({
    outcome: z.string().max(40),
    group: groupSummarySchema.nullable(),
  })
  .meta({ id: "GroupJoinResult" });

export const groupMemberSchema = z
  .object({
    membershipId: z.string(),
    name: z.string().max(120),
    avatarUrl: url.nullable(),
    groupRole: z.string().max(20),
    joinedAt: instant,
    chatUserId: z.string().max(40).nullable(),
    isYou: z.boolean(),
  })
  .meta({ id: "GroupMember" });

export const groupMemberPageSchema = z
  .object({
    items: z.array(groupMemberSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int(),
  })
  .meta({ id: "GroupMemberPage" });

export const groupJoinRequestItemSchema = z
  .object({
    requestId: z.string(),
    name: z.string().max(120),
    avatarUrl: url.nullable(),
    message: z.string().max(500).nullable(),
    requestedAt: instant,
  })
  .meta({ id: "GroupJoinRequestItem" });

export const groupJoinRequestPageSchema = z
  .object({
    items: z.array(groupJoinRequestItemSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "GroupJoinRequestPage" });

export const decideGroupRequestSchema = z
  .object({ decision: z.enum(["approve", "decline"]) })
  .meta({ id: "DecideGroupRequest" });

/** approved, declined, already_decided, full, requester_unavailable, banned, not_found. */
export const groupCommandResultSchema = z
  .object({ outcome: z.string().max(40) })
  .meta({ id: "GroupCommandResult" });

export const setGroupRoleRequestSchema = z
  .object({ groupRole: z.enum(["member", "leader", "manager"]) })
  .meta({ id: "SetGroupRoleRequest" });

export const removeGroupMemberRequestSchema = z
  .object({
    ban: z.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
  })
  .meta({ id: "RemoveGroupMemberRequest" });

export const groupInvitationSchema = z
  .object({
    url: url,
    expiresAt: instant,
    maxUses: z.number().int(),
  })
  .meta({ id: "GroupInvitation" });

export const groupInvitationTokenRequestSchema = z
  .object({ token: z.string().min(16).max(512) })
  .meta({ id: "GroupInvitationTokenRequest" });

/** Enough to say "Join Tuesday Night Men's Group at Grace" — nothing more. */
export const groupInvitationPreviewSchema = z
  .object({
    groupId: z.string(),
    groupName: z.string().max(80),
    coverImageUrl: url.nullable(),
    churchSlug,
    churchName: z.string(),
  })
  .meta({ id: "GroupInvitationPreview" });

export const groupEventRsvpCountsSchema = z
  .object({ going: z.number().int(), maybe: z.number().int(), notGoing: z.number().int() })
  .meta({ id: "GroupEventRsvpCounts" });

export const groupEventAttendanceSummarySchema = z
  .object({
    taken: z.boolean(),
    present: z.number().int(),
    absent: z.number().int(),
    guests: z.number().int(),
    firstTimeGuests: z.number().int(),
  })
  .meta({ id: "GroupEventAttendanceSummary" });

export const groupEventDetailSchema = z
  .object({
    event: groupEventSummarySchema,
    groupName: z.string().max(80),
    description: z.string().max(4000).nullable(),
    locationAddress: z.string().max(500).nullable(),
    onlineMeetingUrl: url.nullable(),
    rsvpCounts: groupEventRsvpCountsSchema,
    /** Leaders only. */
    attendance: groupEventAttendanceSummarySchema.nullable(),
    canEdit: z.boolean(),
    canTakeAttendance: z.boolean(),
  })
  .meta({ id: "GroupEventDetail" });

export const groupEventPageSchema = z
  .object({
    items: z.array(groupEventSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "GroupEventPage" });

export const upsertGroupEventRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).nullable().optional(),
    startsAt: instant,
    endsAt: instant,
    /** IANA; the church's own zone when omitted. */
    timezone: z.string().max(64).optional(),
    locationName: z.string().trim().max(200).nullable().optional(),
    locationAddress: z.string().trim().max(500).nullable().optional(),
    onlineMeetingUrl: z.string().trim().max(2048).nullable().optional(),
  })
  .meta({ id: "UpsertGroupEventRequest" });

export const groupEventRsvpRequestSchema = z
  .object({ response: z.enum(["going", "maybe", "not_going"]) })
  .meta({ id: "GroupEventRsvpRequest" });

export const groupAttendanceEntrySchema = z
  .object({
    membershipId: z.string(),
    name: z.string().max(120),
    avatarUrl: url.nullable(),
    groupRole: z.string().max(20),
    present: z.boolean(),
    /** False while the church has not yet confirmed who this person is. */
    recordable: z.boolean(),
  })
  .meta({ id: "GroupAttendanceEntry" });

export const groupAttendanceSheetSchema = z
  .object({
    eventId: z.string(),
    title: z.string().max(120),
    startsAt: instant,
    timezone: z.string().max(64),
    taken: z.boolean(),
    entries: z.array(groupAttendanceEntrySchema),
    presentCount: z.number().int(),
    absentCount: z.number().int(),
    guestCount: z.number().int(),
    firstTimeGuestCount: z.number().int(),
    notes: z.string().max(1000).nullable(),
    /** Attendance can be recorded until this instant. */
    recordableUntil: instant,
    canRecord: z.boolean(),
    /** Why not: too_early, too_late, cancelled. */
    lockedReason: z.string().max(40).nullable(),
  })
  .meta({ id: "GroupAttendanceSheet" });

export const submitGroupAttendanceRequestSchema = z
  .object({
    presentMembershipIds: z.array(z.string().max(64)).max(1000),
    guestCount: z.number().int().min(0).max(1000),
    firstTimeGuestCount: z.number().int().min(0).max(1000),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .meta({ id: "SubmitGroupAttendanceRequest" });

export const chatSessionSchema = z
  .object({
    appKey: z.string().max(80),
    /** Opaque tenant filter for native conversation lists. */
    churchTeam: z.string().max(64),
    chatUserId: z.string().max(40),
    userToken: z.string().max(2048),
    expiresAt: instant,
    /** Messaging suspended in this church until this instant (or indefinitely when `suspended` and null). */
    suspended: z.boolean(),
    suspendedUntil: instant.nullable(),
  })
  .meta({ id: "ChatSession" });

/** Where a chat push or link lands, re-authorized now. `kind`: group, direct. */
export const chatRouteSchema = z
  .object({
    kind: z.string().max(20),
    churchSlug,
    groupId: z.string().nullable(),
    cid: z.string().max(80),
    messageId: z.string().max(128).nullable(),
  })
  .meta({ id: "ChatRoute" });

export const groupNotificationSettingSchema = z
  .object({
    groupId: z.string(),
    groupName: z.string().max(80),
    /** default, all, mentions, muted. */
    level: z.string().max(20),
  })
  .meta({ id: "GroupNotificationSetting" });

export const messagingPreferencesSchema = z
  .object({
    /** all, mentions, off. */
    level: z.string().max(20),
    groups: z.array(groupNotificationSettingSchema),
  })
  .meta({ id: "MessagingPreferences" });

export const setMessagingLevelRequestSchema = z
  .object({ level: z.enum(["all", "mentions", "off"]) })
  .meta({ id: "SetMessagingLevelRequest" });

export const setGroupNotificationRequestSchema = z
  .object({ level: z.enum(["default", "all", "mentions", "muted"]) })
  .meta({ id: "SetGroupNotificationRequest" });

export const messagingContactSchema = z
  .object({
    chatUserId: z.string().max(40),
    name: z.string().max(120),
    avatarUrl: url.nullable(),
    /** "Leader · Wednesday Bible Study". */
    context: z.string().max(160).nullable(),
  })
  .meta({ id: "MessagingContact" });

export const messagingContactPageSchema = z
  .object({
    items: z.array(messagingContactSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "MessagingContactPage" });

export const startDirectMessageRequestSchema = z
  .object({ chatUserId: z.string().min(3).max(40) })
  .meta({ id: "StartDirectMessageRequest" });

/** `state`: ready, read_only, or pending (authorized; still being set up). */
export const directConversationSchema = z
  .object({
    cid: z.string().max(80),
    channelId: z.string().max(64),
    state: z.string().max(20),
  })
  .meta({ id: "DirectConversation" });

export const chatReportRequestSchema = z
  .object({
    cid: z.string().min(3).max(80),
    messageId: z.string().max(128).optional(),
    reportedChatUserId: z.string().max(40).optional(),
    reason: z.enum(["spam", "harassment", "hate", "sexual", "violence", "self_harm", "inappropriate", "other"]),
    details: z.string().trim().max(1000).optional(),
  })
  .meta({ id: "ChatReportRequest" });

export const chatReportResultSchema = z
  .object({ received: z.boolean() })
  .meta({ id: "ChatReportResult" });

export const chatBlockRequestSchema = z
  .object({ chatUserId: z.string().min(3).max(40) })
  .meta({ id: "ChatBlockRequest" });

export const chatBlockedPersonSchema = z
  .object({
    chatUserId: z.string().max(40),
    name: z.string().max(120),
    blockedAt: instant,
  })
  .meta({ id: "ChatBlockedPerson" });

export const chatBlockListSchema = z
  .object({ items: z.array(chatBlockedPersonSchema) })
  .meta({ id: "ChatBlockList" });

/**
 * A FaithForm thing shared into a conversation, resolved now for this reader.
 * A message only ever carries `{kind, id}`; everything shown here is fetched
 * and re-authorized on each read, so a deleted or private item renders as
 * `available: false` rather than as what it once said.
 */
export const chatCardSchema = z
  .object({
    kind: z.string().max(40),
    id: z.string().max(64),
    available: z.boolean(),
    title: z.string().max(200).nullable(),
    subtitle: z.string().max(300).nullable(),
    imageUrl: url.nullable(),
    startsAt: instant.nullable(),
    endsAt: instant.nullable(),
    locationName: z.string().max(200).nullable(),
    /** An in-app link the card opens. */
    deepLink: z.string().max(512).nullable(),
  })
  .meta({ id: "ChatCard" });

export const CONTRACT_SCHEMAS = {
  Deprecation: deprecationSchema,
  FieldIssue: fieldIssueSchema,
  Meta: metaSchema,
  ErrorBody: errorBodySchema,
  Failure: failureSchema,
  VisitorProfile: visitorProfileSchema,
  AppThemePalette: appThemePaletteSchema,
  ChurchAppTheme: churchAppThemeSchema,
  ChurchThemeSettings: churchThemeSettingsSchema,
  UpdateChurchThemeRequest: updateChurchThemeRequestSchema,
  ChurchRelationship: churchRelationshipSchema,
  AccountRequest: accountRequestSchema,
  Bootstrap: bootstrapSchema,
  RelationshipPage: relationshipPageSchema,
  SelectedChurch: selectedChurchSchema,
  SignOutResult: signOutResultSchema,
  Health: healthSchema,
  UpdateProfileRequest: updateProfileRequestSchema,
  SelectChurchRequest: selectChurchRequestSchema,
  ConsentRequest: consentRequestSchema,
  AccountActionRequest: accountActionRequestSchema,
  DiscoveredChurch: discoveredChurchSchema,
  DiscoveryPage: discoveryPageSchema,
  PublicCampus: publicCampusSchema,
  PublicServiceTime: publicServiceTimeSchema,
  ChurchSocialLink: churchSocialLinkSchema,
  ChurchQuickLink: churchQuickLinkSchema,
  ChurchProfile: churchProfileSchema,
  OnboardingState: onboardingStateSchema,
  FeedItem: feedItemSchema,
  FeedPage: feedPageSchema,
  SchedulePage: schedulePageSchema,
  NotificationPreference: notificationPreferenceSchema,
  DeviceInstallation: deviceInstallationSchema,
  FollowRequest: followRequestSchema,
  AcceptInvitationRequest: acceptInvitationRequestSchema,
  InvitationPreview: invitationPreviewSchema,
  InvitationPreviewRequest: invitationPreviewRequestSchema,
  RegisterDeviceRequest: registerDeviceRequestSchema,
  SetPreferenceRequest: setPreferenceRequestSchema,
  EligibleOccurrence: eligibleOccurrenceSchema,
  AttendanceCapability: attendanceCapabilitySchema,
  AttendanceResult: attendanceResultSchema,
  AttendanceStatus: attendanceStatusSchema,
  AttendanceHistoryItem: attendanceHistoryItemSchema,
  AttendanceHistoryPage: attendanceHistoryPageSchema,
  AttendanceAttemptRequest: attendanceAttemptRequestSchema,
  AttendanceConsentRequest: attendanceConsentRequestSchema,
  AttendanceConsentResult: attendanceConsentResultSchema,
  GeofenceRegion: geofenceRegionSchema,
  GeofenceWindow: geofenceWindowSchema,
  AttendanceSourceAvailability: attendanceSourceAvailabilitySchema,
  GeofenceConfiguration: geofenceConfigurationSchema,
  GeofenceConfigResponse: geofenceConfigResponseSchema,
  LinkedPresentation: linkedPresentationSchema,
  LinkedService: linkedServiceSchema,
  LiveMedia: liveMediaSchema,
  LiveMediaResponse: liveMediaResponseSchema,
  ArchiveItem: archiveItemSchema,
  MediaPage: mediaPageSchema,
  MediaDetail: mediaDetailSchema,
  SermonListItem: sermonListItemSchema,
  SermonPage: sermonPageSchema,
  SermonPoint: sermonPointSchema,
  SermonOutline: sermonOutlineSchema,
  SermonQuestion: sermonQuestionSchema,
  SermonDetail: sermonDetailSchema,
  PresentationPage: presentationPageSchema,
  PresentationListItem: presentationListItemSchema,
  PresentationPageResponse: presentationPageResponseSchema,
  PresentationTheme: presentationThemeFieldsSchema,
  PresentationSlideRendition: presentationSlideRenditionSchema,
  PresentationRenditions: presentationRenditionsSchema,
  PresentationDetail: presentationDetailSchema,
  PlaybackGrant: playbackGrantSchema,
  PlaybackGrantRequest: playbackGrantRequestSchema,
  GivingFund: givingFundSchema,
  GivingHome: givingHomeSchema,
  StartDonationRequest: startDonationRequestSchema,
  DonationSession: donationSessionSchema,
  DonationStatusResult: donationStatusResultSchema,
  GivingHistoryPage: givingHistoryPageSchema,
  GivingReceipt: givingReceiptSchema,
  GroupTypeSummary: groupTypeSummarySchema,
  GroupLeader: groupLeaderSchema,
  GroupEventSummary: groupEventSummarySchema,
  GroupChatInfo: groupChatInfoSchema,
  GroupSummary: groupSummarySchema,
  MyGroups: myGroupsSchema,
  GroupDiscoveryPage: groupDiscoveryPageSchema,
  GroupCampusOption: groupCampusOptionSchema,
  GroupFilters: groupFiltersSchema,
  GroupCapabilities: groupCapabilitiesSchema,
  GroupSchedule: groupScheduleSchema,
  GroupLocation: groupLocationSchema,
  GroupDetail: groupDetailSchema,
  JoinGroupRequest: joinGroupRequestSchema,
  UpdateGroupDetailsRequest: updateGroupDetailsRequestSchema,
  GroupJoinResult: groupJoinResultSchema,
  GroupMember: groupMemberSchema,
  GroupMemberPage: groupMemberPageSchema,
  GroupJoinRequestItem: groupJoinRequestItemSchema,
  GroupJoinRequestPage: groupJoinRequestPageSchema,
  DecideGroupRequest: decideGroupRequestSchema,
  GroupCommandResult: groupCommandResultSchema,
  SetGroupRoleRequest: setGroupRoleRequestSchema,
  RemoveGroupMemberRequest: removeGroupMemberRequestSchema,
  GroupInvitation: groupInvitationSchema,
  GroupInvitationTokenRequest: groupInvitationTokenRequestSchema,
  GroupInvitationPreview: groupInvitationPreviewSchema,
  GroupEventRsvpCounts: groupEventRsvpCountsSchema,
  GroupEventAttendanceSummary: groupEventAttendanceSummarySchema,
  GroupEventDetail: groupEventDetailSchema,
  GroupEventPage: groupEventPageSchema,
  UpsertGroupEventRequest: upsertGroupEventRequestSchema,
  GroupEventRsvpRequest: groupEventRsvpRequestSchema,
  GroupAttendanceEntry: groupAttendanceEntrySchema,
  GroupAttendanceSheet: groupAttendanceSheetSchema,
  SubmitGroupAttendanceRequest: submitGroupAttendanceRequestSchema,
  ChatSession: chatSessionSchema,
  ChatRoute: chatRouteSchema,
  GroupNotificationSetting: groupNotificationSettingSchema,
  MessagingPreferences: messagingPreferencesSchema,
  SetMessagingLevelRequest: setMessagingLevelRequestSchema,
  SetGroupNotificationRequest: setGroupNotificationRequestSchema,
  MessagingContact: messagingContactSchema,
  MessagingContactPage: messagingContactPageSchema,
  StartDirectMessageRequest: startDirectMessageRequestSchema,
  DirectConversation: directConversationSchema,
  ChatReportRequest: chatReportRequestSchema,
  ChatReportResult: chatReportResultSchema,
  ChatBlockRequest: chatBlockRequestSchema,
  ChatBlockedPerson: chatBlockedPersonSchema,
  ChatBlockList: chatBlockListSchema,
  ChatCard: chatCardSchema,
} as const;

export const CONTRACT_ENUMS = {
  RelationshipState: RELATIONSHIP_STATES,
  JoinPolicy: JOIN_POLICIES,
  ConsentState: ["unset", "granted", "denied", "revoked"],
  AccountStatus: ["active", "deactivated", "deletion_requested", "deleted"],
  AccountRequestKind: ["export", "deletion"],
  AccountRequestStatus: [
    "pending",
    "processing",
    "completed",
    "failed",
    "cancelled",
  ],
  MobileErrorCode: MOBILE_ERROR_CODE_LIST,
  AnnouncementVisibility: ["public", "followers", "members"],
  NotificationTopic: ["announcements", "events"],
  DevicePlatform: ["ios", "android"],
  AttendanceSource: ["manual", "admin", "geofence", "qr", "kiosk"],
  AttendanceOutcome: [
    "counted", "already_counted", "pending_confirmation", "rejected", "reversed",
  ],
  MediaKind: ["live", "recording"],
  MediaRenditionKind: ["hls", "progressive"],
  LiveMediaState: ["live", "upcoming", "recent_ended"],
  GivingAvailability: ["available", "not_accepting", "not_found"],
  DonationStatus: [
    "initiated", "requires_action", "processing", "succeeded",
    "failed", "cancelled", "refunded", "disputed",
  ],
  GiftType: ["one_time", "recurring"],
  GroupRole: ["member", "leader", "manager"],
  GroupMembershipState: ["member", "requested", "invited", "not_member", "banned"],
  GroupJoinAction: [
    "join", "request", "cancel_request", "leave", "invitation_required", "full", "closed", "unavailable",
  ],
  GroupEnrollment: ["open", "approval_required", "invitation_only", "closed"],
  GroupVisibility: ["public", "unlisted", "private"],
  GroupNotificationLevel: ["default", "all", "mentions", "muted"],
  MessagingLevel: ["all", "mentions", "off"],
  GroupRsvp: ["going", "maybe", "not_going"],
  GroupChatState: ["ready", "read_only", "unavailable"],
  ChatReportReason: [
    "spam", "harassment", "hate", "sexual", "violence", "self_harm", "inappropriate", "other",
  ],
  ChatCardKind: ["group_event", "church_event", "sermon"],
} as const;

export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type VisitorProfileDto = z.infer<typeof visitorProfileSchema>;
export type ChurchRelationshipDto = z.infer<typeof churchRelationshipSchema>;

export type DiscoveredChurchDto = z.infer<typeof discoveredChurchSchema>;
export type ChurchProfileDto = z.infer<typeof churchProfileSchema>;
export type FeedItemDto = z.infer<typeof feedItemSchema>;
export type OnboardingStateDto = z.infer<typeof onboardingStateSchema>;
