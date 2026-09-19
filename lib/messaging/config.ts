/**
 * Chat provider configuration.
 *
 * `STREAM_CHAT_API_KEY` is Stream's public app key — clients receive it with
 * their user token. `STREAM_CHAT_API_SECRET` signs user tokens, authenticates
 * server calls and verifies webhooks, and never leaves the server.
 *
 * Named `STREAM_CHAT_*` rather than `STREAM_*` because this repository's
 * `STREAM_*` variables belong to live video streaming (the relay, playback and
 * ingest secrets), which is unrelated.
 *
 * Absent configuration is not an error until something needs chat: Groups
 * keeps working, and every chat entry point answers "unavailable" rather than
 * pretending. A *half* configuration is refused in production by
 * `assertProductionEnv`.
 */

export type MessagingConfig = {
  apiKey: string;
  apiSecret: string;
  /** Only for tests and local development; ignored in production. */
  baseUrl?: string;
  /** Push provider names registered by scripts/configure-stream-chat.mjs. */
  apnProviderName: string;
  firebaseProviderName: string;
};

/** Chat user tokens live an hour; clients refresh through a token provider. */
export const CHAT_TOKEN_TTL_SECONDS = 60 * 60;

const PLACEHOLDER = /replace-me|xxxxxxxx|your-|example/i;

export function readMessagingConfig(env: NodeJS.ProcessEnv = process.env): MessagingConfig | null {
  const apiKey = env.STREAM_CHAT_API_KEY?.trim();
  const apiSecret = env.STREAM_CHAT_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  if (PLACEHOLDER.test(apiKey) || PLACEHOLDER.test(apiSecret)) return null;

  const production = env.NODE_ENV === "production";
  const rawBase = env.STREAM_CHAT_BASE_URL?.trim();
  // A base-URL override points every server call — and the secret that signs
  // them — somewhere else. Useful against a local fake; never in production.
  const baseUrl = !production && rawBase && /^https?:\/\//.test(rawBase) ? rawBase : undefined;

  return {
    apiKey,
    apiSecret,
    baseUrl,
    apnProviderName: env.STREAM_CHAT_APN_PROVIDER?.trim() || "faithform-apn",
    firebaseProviderName: env.STREAM_CHAT_FIREBASE_PROVIDER?.trim() || "faithform-firebase",
  };
}

export function isMessagingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readMessagingConfig(env) !== null;
}

/**
 * Exactly one of the two is set. Refused in production: a deployment that is
 * half-configured would pass every other check and fail only when a member
 * opens a conversation.
 */
export function isMessagingHalfConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = Boolean(env.STREAM_CHAT_API_KEY?.trim());
  const secret = Boolean(env.STREAM_CHAT_API_SECRET?.trim());
  return key !== secret;
}
