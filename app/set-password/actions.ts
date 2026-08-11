"use server";

import {
  MUST_CHANGE_PASSWORD_KEY,
  validateNewPassword,
} from "@/lib/auth/temp-password";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SetPasswordState = {
  ok: boolean;
  error?: string;
};

export async function setOwnPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = formData.get("password")?.toString() ?? "";
  const confirmation = formData.get("confirm_password")?.toString() ?? "";

  const invalid = validateNewPassword(password, confirmation);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    // Supabase phrases reuse rejection as an "AuthApiError" the invitee cannot
    // act on; say the actual thing instead.
    if (/different from the old password/i.test(error.message)) {
      return {
        ok: false,
        error: "Choose a password you haven't used here before.",
      };
    }
    return { ok: false, error: error.message };
  }

  // Clearing the flag needs the service role — a user cannot edit their own
  // app-controlled metadata. Without the key the password change still stands;
  // they would simply be asked again, which is the safe way to fail.
  const admin = createAdminClientOrNull();
  if (admin) {
    const { error: metadataError } = await admin.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...(user.user_metadata ?? {}),
          [MUST_CHANGE_PASSWORD_KEY]: false,
        },
      },
    );
    if (metadataError) {
      console.error("setOwnPassword metadata:", metadataError.message);
    }
  }

  return { ok: true };
}
