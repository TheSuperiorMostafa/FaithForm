import { createClient } from "@/lib/supabase/server";
import { redirectToSettings } from "@/lib/integrations/app-redirect";

export async function assertOAuthSessionUser(
  expectedUserId: string,
  returnTo?: string,
): Promise<Response | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== expectedUserId) {
    return redirectToSettings({ integration_error: "session_mismatch" }, returnTo);
  }

  return null;
}
