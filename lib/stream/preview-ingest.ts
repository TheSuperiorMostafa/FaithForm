import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { StreamIntegrationMetadata } from "@/lib/integrations/types";

export async function setPreviewIngestActive(
  churchId: string,
  active: boolean,
  supabase?: SupabaseClient,
) {
  const integration = await getIntegration(churchId, "stream", supabase);
  if (!integration) return;

  const metadata = (integration.metadata ?? {}) as StreamIntegrationMetadata & {
    preview_ingest_active?: boolean;
    preview_ingest_at?: string;
  };

  await saveIntegration(
    {
      churchId,
      provider: "stream",
      accessToken: integration.access_token,
      refreshToken: integration.refresh_token,
      tokenExpiresAt: integration.token_expires_at
        ? new Date(integration.token_expires_at)
        : null,
      metadata: {
        ...metadata,
        preview_ingest_active: active,
        preview_ingest_at: active ? new Date().toISOString() : undefined,
      },
      connectedBy: integration.connected_by ?? undefined,
    },
    supabase,
  );
}

export async function isPreviewIngestActive(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  const integration = await getIntegration(churchId, "stream", supabase);
  if (!integration) return false;

  const metadata = (integration.metadata ?? {}) as {
    preview_ingest_active?: boolean;
  };

  return Boolean(metadata.preview_ingest_active);
}
