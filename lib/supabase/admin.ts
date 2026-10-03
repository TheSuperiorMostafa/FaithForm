import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function resolveSupabaseSecretKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

type AdminClientOptions = { signal?: AbortSignal };

export function createAdminClientOrNull(options?: AdminClientOptions): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = resolveSupabaseSecretKey();

  if (!url || !secretKey) {
    return null;
  }

  return createClient(url, secretKey, {
    ...(options?.signal ? {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const signals = [options.signal, init?.signal,
            input instanceof Request ? input.signal : null,
          ].filter((signal): signal is AbortSignal => Boolean(signal));
          return fetch(input, { ...init, signal: AbortSignal.any(signals) });
        },
      },
    } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAdminClient(options?: AdminClientOptions): SupabaseClient {
  const client = createAdminClientOrNull(options);
  if (!client) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) for admin client",
    );
  }
  return client;
}

export function isAdminClientConfigured(): boolean {
  return createAdminClientOrNull() !== null;
}
