import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function resolveSupabaseSecretKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createAdminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = resolveSupabaseSecretKey();

  if (!url || !secretKey) {
    return null;
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAdminClient(): SupabaseClient {
  const client = createAdminClientOrNull();
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
