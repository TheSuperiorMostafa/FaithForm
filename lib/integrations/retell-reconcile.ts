import type { SupabaseClient } from "@supabase/supabase-js";
import { compareSecret } from "@/lib/security/compare-secret";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const CHURCH_BATCH = 4;
const CONCURRENCY = 2;
const BUDGET_MS = 48_000;
const INTERVAL_MS = 120_000;

type ImportResult = { imported: number; skipped: number };
type Dependencies = {
  secret: () => string | undefined;
  admin: (signal: AbortSignal) => SupabaseClient;
  importCalls: (churchId: string, admin: SupabaseClient, signal: AbortSignal) => Promise<ImportResult>;
  now?: () => number;
};

/** Time slots rotate a bounded batch through every mapped church, not only the first rows. */
export function rotatingChurchBatch(ids: string[], now: number): string[] {
  if (!ids.length) return [];
  const start = (Math.floor(now / INTERVAL_MS) * CHURCH_BATCH) % ids.length;
  return Array.from({ length: Math.min(CHURCH_BATCH, ids.length) }, (_, index) => ids[(start + index) % ids.length]);
}

export function createRetellReconcileHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const headers = { "Cache-Control": "no-store" };
    if (!compareSecret(token, deps.secret())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });

    const now = deps.now ?? Date.now;
    const started = now();
    const signal = AbortSignal.timeout(BUDGET_MS);
    const summary = { checked: 0, imported: 0, skipped: 0, failed: 0 };
    try {
      const admin = deps.admin(signal);
      const ids: string[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        signal.throwIfAborted();
        const { data, error } = await admin.from("voice_assistant_settings")
          .select("church_id").not("retail_ai_agent_id", "is", null)
          .order("church_id", { ascending: true }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error("Agent mapping read failed");
        const rows = (data ?? []) as { church_id: string }[];
        ids.push(...rows.map(row => row.church_id));
        if (rows.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1) throw new Error("Agent mapping capacity exceeded");
      }
      const batch = rotatingChurchBatch(ids, started);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
        while (next < batch.length) {
          const index = next++;
          if (signal.aborted || now() - started >= BUDGET_MS) { summary.failed += 1; continue; }
          try {
            const result = await deps.importCalls(batch[index], admin, signal);
            summary.checked += 1;
            summary.imported += result.imported;
            summary.skipped += result.skipped;
          } catch {
            summary.failed += 1;
          }
        }
      }));
      return Response.json({ ok: summary.failed === 0, ...summary }, { status: summary.failed ? 503 : 200, headers });
    } catch {
      return Response.json({ ok: false, ...summary, failed: summary.failed + 1 }, { status: 503, headers });
    }
  };
}
