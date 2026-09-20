import { getChurchAuth } from "@/lib/auth/church";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await getChurchAuth();
  const headers = { "Cache-Control": "private, no-store" };
  if (!auth) return Response.json({ error: "unauthenticated" }, { status: 401, headers });
  const { data, error } = await createAdminClient().from("visitor_accounts")
    .select("avatar_url").eq("user_id", auth.userId).maybeSingle();
  if (error) return Response.json({ error: "unavailable" }, { status: 503, headers });
  return Response.json({ avatarUrl: data?.avatar_url ?? null }, { headers });
}
