import { getChurchAuth } from "@/lib/auth/church";
import { redirectToSettings } from "@/lib/integrations/app-redirect";
import type { OAuthStatePayload } from "@/lib/integrations/oauth-state";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The person finishing a connection is the one who started it, and may still
 * connect accounts for that church.
 *
 * Matching the session to the state is not enough on its own. A state is made
 * when someone presses Connect, and their access can change before they come
 * back: an admin who was demoted or removed, holding a state copied from an
 * earlier attempt, could otherwise bind their own YouTube, Facebook or Google
 * account to the church — its live stream would go to their channel. So the
 * way in the connect route checked is checked again here.
 */
export async function assertOAuthSessionUser(
  payload: OAuthStatePayload,
  returnTo?: string,
): Promise<Response | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== payload.userId) {
    return redirectToSettings({ integration_error: "session_mismatch" }, returnTo);
  }

  const allowed =
    payload.via === "invite"
      ? await holdsOpenInvite(payload.churchId, user.email)
      : await isAdminOf(payload.churchId);

  if (!allowed) {
    return redirectToSettings({ integration_error: "not_allowed" }, returnTo);
  }

  return null;
}

async function isAdminOf(churchId: string): Promise<boolean> {
  const auth = await getChurchAuth();
  return Boolean(auth?.isAdmin && auth.churchId === churchId);
}

/** The onboarding path: an unaccepted, unexpired invite to this church, for this email. */
async function holdsOpenInvite(churchId: string, email: string | undefined): Promise<boolean> {
  if (!email) return false;
  const admin = createAdminClientOrNull();
  if (!admin) return false;
  const { data, error } = await admin
    .from("church_invites")
    .select("id, email")
    .eq("church_id", churchId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error) return false;
  const wanted = email.trim().toLowerCase();
  return (data ?? []).some((row) => String(row.email ?? "").trim().toLowerCase() === wanted);
}
