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
  publishKey: string | null;
  youtubeUrl: string;
  facebookUrl: string;
  destinationCount: number;
};

const STREAM_PROVIDER = "stream";
const STREAM_PATH_PREFIX = "live";
const STREAM_KEY_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const STREAM_PATH_PATTERN =
  /^live\/([0-9a-fA-F-]{36})\/([A-Za-z0-9_-]{16,})$/;

function normalizeRelayHost(value: string | undefined): string {
  return value?.trim() || "stream.faithform.io";
}

export function resolveStreamRelayHost(): string {
  return normalizeRelayHost(
    process.env.NEXT_PUBLIC_STREAM_RELAY_HOST ?? process.env.STREAM_RELAY_HOST,
  );
}

export function generateStreamPublishKey(): string {
  return randomBytes(24).toString("base64url");
}

export function buildStreamPath(churchId: string, publishKey: string): string {
  return `${STREAM_PATH_PREFIX}/${churchId}/${publishKey}`;
}

export function buildStreamName(churchId: string, publishKey: string): string {
  return `${churchId}/${publishKey}`;
}

export function parseStreamPath(path: string): {
  churchId: string;
  publishKey: string;
} | null {
  const normalized = path.trim().replace(/\/whip$/, "").replace(/^\/+/, "");
  const match = STREAM_PATH_PATTERN.exec(normalized);
  if (!match) {
    const bare = /^([0-9a-fA-F-]{36})\/([A-Za-z0-9_-]{16,})$/.exec(normalized);
    if (!bare) return null;
    return { churchId: bare[1], publishKey: bare[2] };
  }

  return {
    churchId: match[1],
    publishKey: match[2],
  };
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
  const publishKey = integration?.access_token?.trim() || null;
  const streamPath = publishKey ? buildStreamPath(churchId, publishKey) : null;
  const streamName = publishKey ? buildStreamName(churchId, publishKey) : null;
  const destinations = getStreamDestinationsFromMetadata(metadata);

  return {
    connected: Boolean(publishKey),
    relayHost,
    ingestServerUrl: `rtmp://${relayHost}/${STREAM_PATH_PREFIX}`,
    streamName,
    streamPath,
    publishKey: options?.includeSecret ? publishKey : null,
    youtubeUrl: metadata.youtube_url?.trim() ?? "",
    facebookUrl: metadata.facebook_url?.trim() ?? "",
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
  const publishKey =
    existing?.access_token?.trim() || generateStreamPublishKey();

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
      accessToken: publishKey,
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
  const publishKey = generateStreamPublishKey();

  await saveIntegration(
    {
      churchId,
      provider: STREAM_PROVIDER,
      accessToken: publishKey,
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
  const publishKey =
    existing?.access_token?.trim() || generateStreamPublishKey();

  await saveIntegration(
    {
      churchId,
      provider: STREAM_PROVIDER,
      accessToken: publishKey,
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

export async function rotateStreamRelayKey(
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
): Promise<StreamRelaySettings> {
  const existing = await getIntegration(churchId, STREAM_PROVIDER, supabase);
  const metadata = parseStreamMetadata(existing?.metadata);

  await saveIntegration(
    {
      churchId,
      provider: STREAM_PROVIDER,
      accessToken: generateStreamPublishKey(),
      refreshToken: null,
      tokenExpiresAt: null,
      metadata: {
        relay_host: normalizeRelayHost(
          metadata.relay_host ?? resolveStreamRelayHost(),
        ),
        youtube_url: metadata.youtube_url?.trim() || undefined,
        facebook_url: metadata.facebook_url?.trim() || undefined,
      },
      connectedBy: userId,
    },
    supabase,
  );

  return getStreamRelaySettings(churchId, {
    includeSecret: true,
    supabase,
  });
}

export function isValidStreamPublishKey(value: string): boolean {
  return STREAM_KEY_PATTERN.test(value.trim());
}
