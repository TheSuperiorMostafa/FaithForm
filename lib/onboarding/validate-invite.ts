import { createAdminClient } from "@/lib/supabase/admin";

export type ValidInvite = {
  id: string;
  churchId: string;
  email: string;
  adminFirstName: string;
  adminLastName: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  church: {
    id: string;
    name: string;
    timezone: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    website: string | null;
    phone: string | null;
    logoUrl: string | null;
    onboardingCompletedAt: string | null;
  };
};

export type InviteErrorCode =
  | "missing_token"
  | "not_found"
  | "expired"
  | "already_accepted"
  | "email_mismatch";

export type InviteValidationResult =
  | { ok: true; invite: ValidInvite }
  | { ok: false; code: InviteErrorCode; message: string };

type InviteRow = {
  id: string;
  church_id: string;
  email: string;
  admin_first_name: string;
  admin_last_name: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  churches: {
    id: string;
    name: string;
    timezone: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    website: string | null;
    phone: string | null;
    logo_url: string | null;
    onboarding_completed_at: string | null;
  };
};

function mapInvite(row: InviteRow): ValidInvite {
  return {
    id: row.id,
    churchId: row.church_id,
    email: row.email,
    adminFirstName: row.admin_first_name,
    adminLastName: row.admin_last_name,
    token: row.token,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    church: {
      id: row.churches.id,
      name: row.churches.name,
      timezone: row.churches.timezone,
      address: row.churches.address,
      city: row.churches.city,
      state: row.churches.state,
      zip: row.churches.zip,
      website: row.churches.website,
      phone: row.churches.phone,
      logoUrl: row.churches.logo_url,
      onboardingCompletedAt: row.churches.onboarding_completed_at,
    },
  };
}

export async function fetchInviteByToken(
  token: string | null | undefined,
): Promise<InviteValidationResult> {
  if (!token?.trim()) {
    return {
      ok: false,
      code: "missing_token",
      message: "This invite link is invalid.",
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("church_invites")
    .select(
      `
      id,
      church_id,
      email,
      admin_first_name,
      admin_last_name,
      token,
      expires_at,
      accepted_at,
      churches (
        id,
        name,
        timezone,
        address,
        city,
        state,
        zip,
        website,
        phone,
        logo_url,
        onboarding_completed_at
      )
    `,
    )
    .eq("token", token.trim())
    .maybeSingle();

  if (error || !data?.churches) {
    return {
      ok: false,
      code: "not_found",
      message: "This invite link is invalid.",
    };
  }

  const row = data as unknown as InviteRow;

  if (row.accepted_at) {
    return {
      ok: false,
      code: "already_accepted",
      message: "Setup already complete. Sign in to continue.",
    };
  }

  if (new Date(row.expires_at) < new Date()) {
    return {
      ok: false,
      code: "expired",
      message: "This invite has expired. Contact your administrator.",
    };
  }

  return { ok: true, invite: mapInvite(row) };
}

export async function fetchInviteByChurchId(
  churchId: string,
): Promise<ValidInvite | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("church_invites")
    .select(
      `
      id,
      church_id,
      email,
      admin_first_name,
      admin_last_name,
      token,
      expires_at,
      accepted_at,
      churches (
        id,
        name,
        timezone,
        address,
        city,
        state,
        zip,
        website,
        phone,
        logo_url,
        onboarding_completed_at
      )
    `,
    )
    .eq("church_id", churchId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.churches) return null;
  return mapInvite(data as unknown as InviteRow);
}

export function assertInviteEmail(
  invite: ValidInvite,
  userEmail: string | null | undefined,
): InviteValidationResult {
  if (
    !userEmail ||
    userEmail.toLowerCase() !== invite.email.toLowerCase()
  ) {
    return {
      ok: false,
      code: "email_mismatch",
      message: "Sign in with the email address that received this invite.",
    };
  }
  return { ok: true, invite };
}
