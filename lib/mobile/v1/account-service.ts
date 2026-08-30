import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import {
  ensureVisitorAccount,
  getVisitorAccount,
  recordConsent,
  updateVisitorProfile,
  bumpAuthorizationVersion,
  type VisitorAccount,
} from "@/lib/faithful/account";
import {
  buildAccountExport,
  listAccountRequests,
  requestAccountAction,
} from "@/lib/faithful/account-lifecycle";
import { grantsPublishedContentAccess } from "@/lib/faithful/relationship-state";
import { retireInstallationsForAccount } from "@/lib/faithful/push/installations";
import type {
  Bootstrap,
  ChurchRelationshipDto,
  VisitorProfileDto,
} from "@/lib/mobile/v1/contract";

/**
 * Projects Prompt 3's domain services into mobile DTOs.
 *
 * This layer exists so the routes stay thin *and* so the projection is written
 * once: every field a device sees is chosen here, deliberately, rather than by
 * spreading a database row into a response.
 */

/**
 * The policy versions the client must have accepted. Bumping either of these
 * makes every client re-prompt, because the profile's stored version stops
 * matching.
 */
export const REQUIRED_TERMS_VERSION = "2026-08-01";
export const REQUIRED_PRIVACY_VERSION = "2026-08-01";

/**
 * What this server build will actually serve. Prompts 5–11 add their own keys
 * as they land, which is how a released client discovers a feature exists
 * without shipping a new binary.
 */
export const ENABLED_CAPABILITIES = [
  "account",
  "discovery",
  "announcements",
  // Prompt 9. Both navigation modules already carried a `watch` destination
  // with this capability key and no screen behind it; this is what turns it on.
  "watch",
  // Prompts 7 and 8. Automatic attendance and QR/short-code check-in were
  // built, tested and shipped in the source — and never switched on here, so
  // both route registries correctly refused them. The gate was working on the
  // wrong input, which is the least visible way for a feature to be missing.
  "attendance",
  // Prompt 11.
  "giving",
  // Sermon notes. The archive and detail projections are migration 0068, the
  // service is `lib/sermons/v1/sermon-service.ts`, and both platforms register
  // the destination — so unlike every earlier revision of this list, turning
  // this on opens a screen rather than a blank page. A church still sees
  // nothing until it publishes a sermon: visibility defaults to 'none'.
  "sermons",
] as const;

function projectProfile(
  account: VisitorAccount,
  selectedChurchSlug: string | null,
): VisitorProfileDto {
  return {
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    status: account.status,
    termsVersion: account.termsVersion,
    termsAcceptedAt: account.termsAcceptedAt,
    privacyVersion: account.privacyVersion,
    privacyAcceptedAt: account.privacyAcceptedAt,
    autoAttendanceConsent: account.autoAttendanceConsent,
    communicationPrefs: account.communicationPrefs,
    selectedChurchSlug,
    authorizationVersion: account.authorizationVersion,
  };
}

type RelationshipRow = {
  state: string;
  joined_at: string | null;
  updated_at: string;
  churches: unknown;
};

function projectRelationship(row: RelationshipRow): ChurchRelationshipDto | null {
  const church = Array.isArray(row.churches) ? row.churches[0] : row.churches;
  const resolved = church as
    | { slug: string | null; name: string; logo_url: string | null; join_policy: string | null }
    | null;

  // A church without a public handle cannot be addressed by a client at all,
  // so it is omitted rather than returned with a null identifier.
  if (!resolved?.slug) return null;

  const state = row.state as ChurchRelationshipDto["state"];
  return {
    churchSlug: resolved.slug,
    churchName: resolved.name,
    logoUrl: resolved.logo_url ?? null,
    state,
    joinPolicy: (resolved.join_policy ?? "approval_required") as ChurchRelationshipDto["joinPolicy"],
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
    canReadPublishedContent: grantsPublishedContentAccess(
      state as Parameters<typeof grantsPublishedContentAccess>[0],
    ),
  };
}

const RELATIONSHIP_SELECT =
  "id, state, joined_at, updated_at, churches!inner(slug, name, logo_url, join_policy)";

async function loadSelectedChurchSlug(
  selectedChurchId: string | null,
): Promise<string | null> {
  if (!selectedChurchId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("slug")
    .eq("id", selectedChurchId)
    .maybeSingle();
  return (data?.slug as string | null) ?? null;
}

/**
 * Everything the app needs on launch.
 *
 * Creating the account here is what makes first launch work: a brand-new
 * credential has no profile yet, and `ensureVisitorAccount` is idempotent, so
 * two devices launching at once converge on one row.
 */
export async function getBootstrap(userId: string): Promise<Bootstrap> {
  const account = await ensureVisitorAccount(userId);
  const admin = createAdminClient();

  const [{ data: rows }, requests, selectedChurchSlug] = await Promise.all([
    admin
      .from("visitor_church_relationships")
      .select(RELATIONSHIP_SELECT)
      .eq("account_id", account.id)
      .order("id", { ascending: true })
      .limit(50),
    listAccountRequests(userId),
    loadSelectedChurchSlug(account.selectedChurchId),
  ]);

  const relationships = ((rows ?? []) as unknown as RelationshipRow[])
    .map(projectRelationship)
    .filter((value): value is ChurchRelationshipDto => value !== null);

  return {
    profile: projectProfile(account, selectedChurchSlug),
    relationships,
    pendingRequests: requests.map((request) => ({
      id: request.id,
      kind: request.kind,
      status: request.status,
      requestedAt: request.requestedAt,
      completedAt: request.completedAt,
    })),
    requiredTermsVersion: REQUIRED_TERMS_VERSION,
    requiredPrivacyVersion: REQUIRED_PRIVACY_VERSION,
    enabledCapabilities: [...ENABLED_CAPABILITIES],
    serverTime: new Date().toISOString(),
  };
}

export async function listRelationshipsPage(
  userId: string,
  input: { limit: number; cursorId: string | null },
): Promise<{ items: ChurchRelationshipDto[]; nextCursorId: string | null }> {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const admin = createAdminClient();
  let query = admin
    .from("visitor_church_relationships")
    .select(RELATIONSHIP_SELECT)
    .eq("account_id", account.id)
    .order("id", { ascending: true })
    .limit(input.limit + 1);

  if (input.cursorId) query = query.gt("id", input.cursorId);

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load your churches.");

  const rows = (data ?? []) as unknown as (RelationshipRow & { id: string })[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    items: page
      .map(projectRelationship)
      .filter((value): value is ChurchRelationshipDto => value !== null),
    nextCursorId: hasMore ? page[page.length - 1].id : null,
  };
}

export async function applyProfileUpdate(
  userId: string,
  input: { displayName?: string; communicationPrefs?: Record<string, boolean> },
): Promise<VisitorProfileDto> {
  const account = await updateVisitorProfile(userId, input);
  return projectProfile(account, await loadSelectedChurchSlug(account.selectedChurchId));
}

export async function applyConsent(
  userId: string,
  input: unknown,
): Promise<VisitorProfileDto> {
  const account = await recordConsent(userId, input);
  return projectProfile(account, await loadSelectedChurchSlug(account.selectedChurchId));
}

/**
 * Sets the selected church.
 *
 * The slug must name a church this account actually has a relationship with —
 * a preference may not point at a church the person has never engaged with,
 * and a `blocked` relationship is refused outright. This is still only a
 * preference: every later read re-checks authorization regardless.
 */
export async function setSelectedChurch(
  userId: string,
  churchSlug: string | null,
): Promise<{ selectedChurchSlug: string | null; authorizationVersion: number }> {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  if (churchSlug !== null) {
    const admin = createAdminClient();
    const { data: church } = await admin
      .from("churches")
      .select("id")
      .eq("slug", churchSlug)
      .maybeSingle();

    if (!church) throw new VisitorError("church_not_found", "Church not found.");

    const { data: relationship } = await admin
      .from("visitor_church_relationships")
      .select("state")
      .eq("account_id", account.id)
      .eq("church_id", church.id as string)
      .maybeSingle();

    if (!relationship) {
      throw new VisitorError("relationship_not_found", "You do not follow that church.");
    }
    if (relationship.state === "blocked") {
      throw new VisitorError("blocked", "This account is blocked by the church.");
    }
  }

  const updated = await updateVisitorProfile(userId, {
    selectedChurchSlug: churchSlug,
  });

  return {
    selectedChurchSlug: churchSlug,
    authorizationVersion: updated.authorizationVersion,
  };
}

/**
 * Server-side sign-out.
 *
 * Bumping the authorization version is the durable half: the client discards
 * its token locally, and any cached authorization decision keyed to the old
 * version is now detectably stale on every other device too.
 */
export async function signOut(userId: string): Promise<{ authorizationVersion: number }> {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  // Notification authority leaves with the session. A phone that signed out
  // must stop receiving this account's notifications immediately, not at the
  // next successful delivery attempt.
  await retireInstallationsForAccount(account.id, "signed_out");

  await bumpAuthorizationVersion(account.id);
  const refreshed = await getVisitorAccount(userId);

  return { authorizationVersion: refreshed?.authorizationVersion ?? account.authorizationVersion + 1 };
}

export async function submitAccountRequest(
  userId: string,
  kind: "export" | "deletion",
  idempotencyKey: string,
) {
  const request = await requestAccountAction(userId, { kind, idempotencyKey });
  return {
    id: request.id,
    kind: request.kind,
    status: request.status,
    requestedAt: request.requestedAt,
    completedAt: request.completedAt,
  };
}

export { buildAccountExport };
