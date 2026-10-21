"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { toUserError } from "@/lib/errors/user-error";

export async function saveChurchHealth(input: { churchId: string; status: string; note: string }) {
  const actor = await requireSuperAdmin();
  const parsed = z.object({ churchId: z.uuid(), status: z.enum(["auto", "yellow", "red"]), note: z.string().trim().max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a church and a valid health status." };
  const { churchId, status, note } = parsed.data;
  if (status !== "auto" && !note) return { ok: false, error: "Add a short reason for this status." };
  const admin = createAdminClient();
  const { error } = status === "auto"
    ? await admin.from("church_health_reviews").delete().eq("church_id", churchId)
    : await admin.from("church_health_reviews").upsert({ church_id: churchId, status, note, updated_by: actor.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: toUserError(error, "We couldn't save this church's health status") };
  revalidatePath("/admin/churches");
  return { ok: true };
}
