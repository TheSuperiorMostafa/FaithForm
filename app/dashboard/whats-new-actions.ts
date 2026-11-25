"use server";

import { getChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { knownItemIds } from "@/lib/releases/pending";
import { RELEASES } from "@/lib/releases/whats-new";
import { createClient } from "@/lib/supabase/server";

const KNOWN = knownItemIds(RELEASES);
const MAX_ITEMS = 50;

/**
 * Remembers that this person has seen these "What's new" items, on every
 * device. Only ids from lib/releases/whats-new.ts are stored, and only for the
 * signed-in person's own sign-in (row-level security checks it again).
 */
export async function dismissWhatsNew(itemIds: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getChurchAuth();
  if (!auth) return { ok: false, error: "Sign in with your church account to continue." };
  // A platform admin visiting a church never sees the pop-up, so has nothing to save.
  if (auth.impersonation) return { ok: true };

  const ids = Array.isArray(itemIds)
    ? Array.from(new Set(itemIds.filter((id): id is string => typeof id === "string" && KNOWN.has(id)))).slice(0, MAX_ITEMS)
    : [];
  if (ids.length === 0) return { ok: true };

  const { error } = await createClient()
    .from("whats_new_reads")
    .upsert(
      ids.map((item_id) => ({ user_id: auth.userId, item_id })),
      { onConflict: "user_id,item_id", ignoreDuplicates: true },
    );

  if (error) return { ok: false, error: toUserError(error, "We couldn't save that you've seen what's new") };
  return { ok: true };
}
