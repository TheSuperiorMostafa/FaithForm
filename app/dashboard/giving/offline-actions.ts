"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { toUserError } from "@/lib/errors/user-error";
import { amountToCents, offlineGiftSchema } from "@/lib/giving/offline-input";

export async function recordOfflineGifts(input: unknown): Promise<{ok: boolean; count?: number; error?: string}> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return {ok: false, error: "A church admin can record offline donations."};
  const blocked = await featureActionError("giving");
  if (blocked) return {ok: false, error: blocked};
  const parsed = z.object({batchId: z.string().uuid(), gifts: z.array(offlineGiftSchema).min(1).max(500)}).safeParse(input);
  if (!parsed.success) return {ok: false, error: "Check each donation's date, amount, fund and donor details."};
  try {
    const {data, error} = await createAdminClient().rpc("record_offline_gifts", {
      p_church_id: auth.churchId, p_actor_id: auth.userId, p_batch_id: parsed.data.batchId,
      p_gifts: parsed.data.gifts.map(gift => ({
        date: gift.date, amount_cents: amountToCents(gift.amount), fund_id: gift.fundId,
        donor_id: gift.donorId, donor_name: gift.donorName, donor_email: gift.donorEmail.toLowerCase(),
        method: gift.method, gift_type: gift.giftType,
      })),
    });
    if (error) throw error;
    for (const path of ["/dashboard/giving", "/dashboard/giving/gifts", "/dashboard/giving/donors", "/dashboard/giving/statements"]) revalidatePath(path);
    return {ok: true, count: Number(data)};
  } catch(error) {
    console.error("[giving] offline gifts save failed", error);
    return {ok: false, error: toUserError(error, "We couldn't record these donations. Your entries are kept here so you can try again.")};
  }
}
