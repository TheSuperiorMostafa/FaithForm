import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientOrNull } from "@/lib/supabase/admin";

/**
 * Which phone a church's texts leave from.
 *
 * Follow-up texts used to go through one server-wide credential. SMSMobileAPI
 * sends from whichever handset its app is installed on, so every church's
 * members were texted from one pastor's phone — and replied to it. A church
 * now has its own texting connection on `church_integrations` (provider
 * 'sms', migration 0084): the SMSMobileAPI key from the app on *that church's*
 * phone in `access_token`, and the phone's number in `metadata.from_number`.
 *
 * The server-wide credential (`SMS_MOBILE_API_KEY`, or `TWILIO_*`) still
 * works, but only for the one church named by `SMS_ENV_CHURCH_ID` — the church
 * whose phone it actually is. Any other church without its own connection
 * sends nothing, which is the only safe answer: a text from the wrong church
 * is worse than no text.
 */

export type ChurchSmsSender =
  | {
      gateway: "smsmobileapi";
      apiKey: string;
      fromNumber: string | null;
      source: "church" | "server";
    }
  | {
      gateway: "twilio";
      accountSid: string;
      authToken: string;
      fromNumber: string;
      source: "server";
    };

/** What the dashboards may know about a church's texting phone. Never the key. */
export type ChurchSmsStatus = {
  connected: boolean;
  fromNumber: string | null;
  /** "server" means the church is using the server-wide phone (SMS_ENV_CHURCH_ID). */
  source: "church" | "server" | null;
};

const SMS_PROVIDER = "sms";

function serverSender(): ChurchSmsSender | null {
  const apiKey = process.env.SMS_MOBILE_API_KEY?.trim();
  if (apiKey) {
    return {
      gateway: "smsmobileapi",
      apiKey,
      fromNumber: process.env.SMS_MOBILE_API_NUMBER?.trim() || null,
      source: "server",
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (accountSid && authToken && fromNumber) {
    return { gateway: "twilio", accountSid, authToken, fromNumber, source: "server" };
  }

  return null;
}

/** The church allowed to use the server-wide credential, if one is named. */
function serverCredentialChurchId(): string | null {
  return process.env.SMS_ENV_CHURCH_ID?.trim() || null;
}

async function readChurchConnection(
  churchId: string,
  client: SupabaseClient,
): Promise<{ apiKey: string; fromNumber: string | null } | null> {
  const { data, error } = await client
    .from("church_integrations")
    .select("access_token, metadata")
    .eq("church_id", churchId)
    .eq("provider", SMS_PROVIDER)
    .maybeSingle();

  // No row, or a database without migration 0084: simply not connected.
  if (error || !data) return null;

  const apiKey = (data.access_token as string | null)?.trim();
  if (!apiKey) return null;

  const metadata = (data.metadata ?? {}) as { from_number?: unknown };
  const fromNumber =
    typeof metadata.from_number === "string" && metadata.from_number.trim()
      ? metadata.from_number.trim()
      : null;

  return { apiKey, fromNumber };
}

/**
 * The credential to text a church's members with, or null when the church has
 * no phone of its own. Server-side only: the result carries the secret.
 */
export async function getChurchSmsSender(
  churchId: string,
  admin?: SupabaseClient,
): Promise<ChurchSmsSender | null> {
  const client = admin ?? createAdminClientOrNull();
  if (client) {
    const own = await readChurchConnection(churchId, client);
    if (own) {
      return {
        gateway: "smsmobileapi",
        apiKey: own.apiKey,
        fromNumber: own.fromNumber,
        source: "church",
      };
    }
  }

  return serverCredentialChurchId() === churchId ? serverSender() : null;
}

export async function getChurchSmsStatus(
  churchId: string,
  admin?: SupabaseClient,
): Promise<ChurchSmsStatus> {
  const sender = await getChurchSmsSender(churchId, admin);
  return sender
    ? { connected: true, fromNumber: sender.fromNumber, source: sender.source }
    : { connected: false, fromNumber: null, source: null };
}

/**
 * Connects (or updates) a church's texting phone. A blank key keeps the saved
 * one, so the number can be corrected without re-entering the secret.
 */
export async function saveChurchSmsSender(
  churchId: string,
  input: { apiKey: string | null; fromNumber: string | null; userId: string | null },
  admin: SupabaseClient,
): Promise<void> {
  const existing = await readChurchConnection(churchId, admin);
  const apiKey = input.apiKey?.trim() || existing?.apiKey;
  if (!apiKey) {
    throw new Error("Enter the SMSMobileAPI key from the app on the church's phone.");
  }

  const { error } = await admin.from("church_integrations").upsert(
    {
      church_id: churchId,
      provider: SMS_PROVIDER,
      access_token: apiKey,
      metadata: { gateway: "smsmobileapi", from_number: input.fromNumber },
      connected_by: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id,provider" },
  );

  if (error) {
    if (/church_integrations_provider_check|violates check constraint/i.test(error.message)) {
      throw new Error(
        "The database is missing migration 0084, so a texting phone can't be saved yet.",
      );
    }
    throw new Error("Could not save the texting phone.");
  }
}

export async function removeChurchSmsSender(
  churchId: string,
  admin: SupabaseClient,
): Promise<void> {
  const { error } = await admin
    .from("church_integrations")
    .delete()
    .eq("church_id", churchId)
    .eq("provider", SMS_PROVIDER);

  if (error) throw new Error("Could not disconnect the texting phone.");
}
