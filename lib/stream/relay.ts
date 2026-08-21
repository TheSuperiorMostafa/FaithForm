import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { StreamIntegrationMetadata } from "@/lib/integrations/types";

export type StreamDestination = {
  name: "youtube" | "facebook";
  url: string;
};

export type StreamRelaySettings = {
  connected: boolean;
  relayHost: string;
  ingestServerUrl: string;
  streamName: string | null;
  streamPath: string | null;
  youtubeUrl: string;
  facebookUrl: string;
  destinationCount: number;
};

const STREAM_PROVIDER = "stream";
const STREAM_PATH_PREFIX = "live";
const CHURCH_ID_PATTERN = "[0-9a-fA-F-]{36}";
const STREAM_PATH_PATTERN = new RegExp(`^live\/(${CHURCH_ID_PATTERN})$`);
const LEGACY_STREAM_PATH_PATTERN = new RegExp(
  `^live\/(${CHURCH_ID_PATTERN})\/[A-Za-z0-9_-]{16,}$`,
);

function normalizeRelayHost(value: string | undefined): string {
  return value?.trim() || "stream.faithform.io";
}

export function resolveStreamRelayHost(): string {
  return normalizeRelayHost(
    process.env.NEXT_PUBLIC_STREAM_RELAY_HOST ?? process.env.STREAM_RELAY_HOST,
  );
}

function generateStreamConfigurationToken(): string {
  return randomBytes(24).toString("base64url");
}

export function buildStreamPath(churchId: string): string {
  return `${STREAM_PATH_PREFIX}/${churchId}`;
}

export function buildStreamName(churchId: string): string {
  return churchId;
}

export function parseStreamPath(path: string): {
  churchId: string;
  legacyCredentialInPath: boolean;
} | null {
  const normalized = path.trim().replace(/\/whip$/, "").replace(/^\/+/, "");
  const match = STREAM_PATH_PATTERN.exec(normalized);
  if (match) {
    return { churchId: match[1], legacyCredentialInPath: false };
  }

  const bare = new RegExp(`^(${CHURCH_ID_PATTERN})$`).exec(normalized);
  if (bare) return { churchId: bare[1], legacyCredentialInPath: false };

  // Historical recording reconciliation may still present the old path. New
  // ingest/config/lifecycle callers reject this flag so the credential can
  // never authorize publishing or be copied into a new response or log.
  const legacy = LEGACY_STREAM_PATH_PATTERN.exec(normalized);
  return legacy
    ? { churchId: legacy[1], legacyCredentialInPath: true }
    : null;
}

function parseStreamMetadata(
  metadata: Record<string, unknown> | null | undefined,
): StreamIntegrationMetadata {
  return (metadata ?? {}) as StreamIntegrationMetadata;
}

export function sanitizeRelayDestinationUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Destination URLs must be valid RTMP or RTMPS URLs.");
  }

  if (parsed.protocol !== "rtmp:" && parsed.protocol !== "rtmps:") {
    throw new Error("Destination URLs must start with rtmp:// or rtmps://.");
  }

  return trimmed;
}

export function getStreamDestinationsFromMetadata(
  metadata: StreamIntegrationMetadata,
): StreamDestination[] {
  const destinations: StreamDestination[] = [];

  if (metadata.youtube_url?.trim()) {
    destinations.push({ name: "youtube", url: metadata.youtube_url.trim() });
  }
  if (metadata.facebook_url?.trim()) {
    destinations.push({ name: "facebook", url: metadata.facebook_url.trim() });
  }

  return destinations;
}

export async function getStreamRelaySettings(
  churchId: string,
  options?: {
    includeSecret?: boolean;
    includeInternalPath?: boolean;
    supabase?: SupabaseClient;
  },
): Promise<StreamRelaySettings> {
  const integration = await getIntegration(
    churchId,
    STREAM_PROVIDER,
    options?.supabase,
  );
  const metadata = parseStreamMetadata(integration?.metadata);
  const relayHost = normalizeRelayHost(
    metadata.relay_host ?? resolveStreamRelayHost(),
  );
  const configurationToken = integration?.access_token?.trim() || null;
  const includeSecret = options?.includeSecret === true;
  const includeInternalPath = options?.includeInternalPath === true;
  const streamPath =
    includeInternalPath && configurationToken ? buildStreamPath(churchId) : null;
  const streamName =
    includeInternalPath && configurationToken ? buildStreamName(churchId) : null;
  const destinations = getStreamDestinationsFromMetadata(metadata);

  return {
    connected: Boolean(configurationToken),
    relayHost,
    ingestServerUrl: `rtmp://${relayHost}/${STREAM_PATH_PREFIX}`,
    streamName,
    streamPath,
    youtubeUrl: includeSecret ? (metadata.youtube_url?.trim() ?? "") : "",
    facebookUrl: includeSecret ? (metadata.facebook_url?.trim() ?? "") : "",
    destinationCount: destinations.length,
  };
}

export async function saveStreamRelaySettings(
  input: {
    churchId: string;
    userId: string;
    youtubeUrl: string;
    facebookUrl: string;
    relayHost?: string;
  },
  supabase?: SupabaseClient,
): Promise<StreamRelaySettings> {
  const existing = await getIntegration(input.churchId, STREAM_PROVIDER, supabase);
  const existingMeta = parseStreamMetadata(existing?.metadata);
  const relayHost = normalizeRelayHost(input.relayHost ?? existingMeta.relay_host);
  const configurationToken =
    existing?.access_token?.trim() || generateStreamConfigurationToken();

  const metadata: StreamIntegrationMetadata = {
    ...existingMeta,
    relay_host: relayHost,
    youtube_url: sanitizeRelayDestinationUrl(input.youtubeUrl) ?? undefined,
    facebook_url: sanitizeRelayDestinationUrl(input.facebookUrl) ?? undefined,
  };

  await saveIntegration(
    {
      churchId: input.churchId,
      provider: STREAM_PROVIDER,
      accessToken: configurationToken,
      refreshToken: null,
      tokenExpiresAt: null,
      metadata,
      connectedBy: input.userId,
    },
    supabase,
  );

  return getStreamRelaySettings(input.churchId, {
    includeSecret: true,
    supabase,
  });
}

export async function ensureStreamRelayCredentials(
  churchId: string,
  userId: string | null,
  supabase?: SupabaseClient,
): Promise<StreamRelaySettings> {
  const existing = await getIntegration(churchId, STREAM_PROVIDER, supabase);
  if (existing?.access_token?.trim()) {
    return getStreamRelaySettings(churchId, {
      includeSecret: true,
      supabase,
    });
  }

  const relayHost = resolveStreamRelayHost();
  const configurationToken = generateStreamConfigurationToken();

  await saveIntegration(
    {
      churchId,
      provider: STREAM_PROVIDER,
      accessToken: configurationToken,
      refreshToken: null,
      tokenExpiresAt: null,
      metadata: { relay_host: relayHost },
      connectedBy: userId ?? undefined,
    },
    supabase,
  );

  return getStreamRelaySettings(churchId, {
    includeSecret: true,
    supabase,
  });
}

export async function setStreamRelayDestination(
  churchId: string,
  destination: "youtube" | "facebook",
  url: string,
  // Nullable: background jobs may have no acting user. `connected_by` is an FK
  // to auth.users, so a placeholder id would violate the constraint.
  userId: string | null,
  supabase?: SupabaseClient,
): Promise<void> {
  const sanitized = sanitizeRelayDestinationUrl(url);
  if (!sanitized) return;

  const existing = await getIntegration(churchId, STREAM_PROVIDER, supabase);
  const metadata = parseStreamMetadata(existing?.metadata);
  const configurationToken =
    existing?.access_token?.trim() || generateStreamConfigurationToken();

  await saveIntegration(
    {
      churchId,
      provider: STREAM_PROVIDER,
      accessToken: configurationToken,
      refreshToken: null,
      tokenExpiresAt: null,
      metadata: {
        ...metadata,
        relay_host: normalizeRelayHost(
          metadata.relay_host ?? resolveStreamRelayHost(),
        ),
        ...(destination === "youtube"
          ? { youtube_url: sanitized }
          : { facebook_url: sanitized }),
      },
      connectedBy: userId ?? undefined,
    },
    supabase,
  );
}

export async function clearStreamRelayDestinations(
  churchId: string,
  userId: string | null,
  supabase?: SupabaseClient,
): Promise<void> {
  const existing = await getIntegration(churchId, STREAM_PROVIDER, supabase);
  if (!existing) return;

  const metadata = parseStreamMetadata(existing?.metadata);
  await saveIntegration(
    {
      churchId,
      provider: STREAM_PROVIDER,
      accessToken: existing.access_token,
      refreshToken: null,
      tokenExpiresAt: null,
      metadata: {
        ...metadata,
        relay_host: normalizeRelayHost(
          metadata.relay_host ?? resolveStreamRelayHost(),
        ),
        youtube_url: undefined,
        facebook_url: undefined,
      },
      connectedBy: userId ?? undefined,
    },
    supabase,
  );
}
