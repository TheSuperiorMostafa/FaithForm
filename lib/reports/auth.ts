import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentChurchId } from "@/lib/queries/library";

export async function requireChurchContext(
  supabase: SupabaseClient,
): Promise<{ churchId: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) return null;

  return { churchId };
}
