import { z } from "zod";

import { MOBILE_ERROR_CODE_LIST } from "@/lib/mobile/v1/errors";
import { RELATIONSHIP_STATES, JOIN_POLICIES } from "@/lib/faithful/relationship-state";

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

/** One church this account has a relationship with. */
export const churchRelationshipSchema = z.object({
  churchSlug,
  churchName: z.string(),
  logoUrl: url.nullable(),
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

/** The church profile shown before someone follows or joins. */
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
export const liveMediaSchema = z
  .object({
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
     * Faithful gives one-time. This exists so the app can say where recurring
     * lives rather than pretending it does not exist.
     */
    recurringAvailable: z.boolean(),
    givingVersion: z.number().int(),
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

export const CONTRACT_SCHEMAS = {
  Deprecation: deprecationSchema,
  FieldIssue: fieldIssueSchema,
  Meta: metaSchema,
  ErrorBody: errorBodySchema,
  Failure: failureSchema,
  VisitorProfile: visitorProfileSchema,
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
  ChurchProfile: churchProfileSchema,
  OnboardingState: onboardingStateSchema,
  FeedItem: feedItemSchema,
  FeedPage: feedPageSchema,
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
  PlaybackGrant: playbackGrantSchema,
  PlaybackGrantRequest: playbackGrantRequestSchema,
  GivingFund: givingFundSchema,
  GivingHome: givingHomeSchema,
  StartDonationRequest: startDonationRequestSchema,
  DonationSession: donationSessionSchema,
  DonationStatusResult: donationStatusResultSchema,
  GivingHistoryPage: givingHistoryPageSchema,
  GivingReceipt: givingReceiptSchema,
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
} as const;

export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type VisitorProfileDto = z.infer<typeof visitorProfileSchema>;
export type ChurchRelationshipDto = z.infer<typeof churchRelationshipSchema>;

export type DiscoveredChurchDto = z.infer<typeof discoveredChurchSchema>;
export type ChurchProfileDto = z.infer<typeof churchProfileSchema>;
export type FeedItemDto = z.infer<typeof feedItemSchema>;
export type OnboardingStateDto = z.infer<typeof onboardingStateSchema>;
