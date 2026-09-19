"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { removeChurchSmsSender, saveChurchSmsSender } from "@/lib/sms/church-sender";
import { toE164 } from "@/lib/sms/phone";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChurchSmsFormState = {
  ok: boolean;
  error?: string;
  message?: string;
};

function revalidateChurch(churchId: string) {
  revalidatePath(`/admin/churches/${churchId}`);
  revalidatePath("/dashboard/attendance/follow-up");
}

/**
 * Connects a church's own texting phone: the SMSMobileAPI key from the app
 * installed on that church's phone, and the phone's number for the message
 * log. Each church texts from its own phone — never another church's.
 */
export async function saveChurchSms(
  _prev: ChurchSmsFormState,
  formData: FormData,
): Promise<ChurchSmsFormState> {
  const user = await requireSuperAdmin();

  const churchId = formData.get("church_id")?.toString();
  if (!churchId) return { ok: false, error: "Missing church." };

  const apiKey = formData.get("sms_api_key")?.toString().trim() || null;
  const rawNumber = formData.get("sms_from_number")?.toString().trim() ?? "";
  const fromNumber = rawNumber ? toE164(rawNumber) : null;
  if (rawNumber && !fromNumber) {
    return { ok: false, error: "Enter the phone's number like 123-456-7890." };
  }

  try {
    await saveChurchSmsSender(
      churchId,
      { apiKey, fromNumber, userId: user.id },
      createAdminClient(),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not save the texting phone.",
    };
  }

  revalidateChurch(churchId);
  return { ok: true, message: "Texting phone saved." };
}

export async function disconnectChurchSms(
  _prev: ChurchSmsFormState,
  formData: FormData,
): Promise<ChurchSmsFormState> {
  await requireSuperAdmin();

  const churchId = formData.get("church_id")?.toString();
  if (!churchId) return { ok: false, error: "Missing church." };

  try {
    await removeChurchSmsSender(churchId, createAdminClient());
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not disconnect the texting phone.",
    };
  }

  revalidateChurch(churchId);
  return { ok: true, message: "Texting phone disconnected." };
}
