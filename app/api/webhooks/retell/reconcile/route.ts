import { createClient } from "@supabase/supabase-js";
import { importRetellCallsForChurch } from "@/lib/integrations/retell-calls";
import { createRetellReconcileHandler } from "@/lib/integrations/retell-reconcile";

export const dynamic = "force-dynamic";

/** Read-only provider recovery leaves linked agents' existing n8n webhooks intact. */
export const GET = createRetellReconcileHandler({
  secret: () => process.env.CRON_SECRET,
  admin: (signal) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Call reconciliation is not configured");
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, {
        ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
      }) },
    });
  },
  importCalls: (churchId, admin, signal) => importRetellCallsForChurch(churchId, 25, {
    admin, score: false, signal,
  }),
});
