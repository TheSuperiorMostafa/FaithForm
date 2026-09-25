"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth } from "@/lib/auth/church";
import { prepareChurchLogo } from "@/lib/branding/church-logo";
import { normalizeHexColor } from "@/lib/giving/branding";
import { extractLogoTheme } from "@/lib/branding/church-theme";
import { ensureDefaultFunds } from "@/lib/giving/funds";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccountFromStripe } from "@/lib/stripe/connect";
import { normalizeEin } from "@/lib/giving/ein";
import { toUserError } from "@/lib/errors/user-error";

/**
 * Giving settings: web address, bank connection status, statement details,
 * funds and colours. Every action resolves the church from the caller's own
 * session and is admin-only. Failures come back as plain sentences
 * (`toUserError`), never raw database or provider text.
 */
const ADMINS_ONLY = "Only church admins can change giving settings. Ask an admin on your team.";

function revalidateGivingDashboard() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/giving");
  revalidatePath("/dashboard/giving/settings");
  revalidatePath("/dashboard/giving/statements");
}

async function revalidateGivingPaths(churchId: string) {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/giving");
  const admin = createAdminClient();
  const { data } = await admin.from("churches").select("slug").eq("id", churchId).maybeSingle();
  if (data?.slug) {
    revalidatePath(`/give/${data.slug}`);
    revalidatePath(`/give/${data.slug}/portal`);
    revalidatePath(`/give/${data.slug}/thank-you`);
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function updateChurchSlug(slug: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) {
    return { error: "Only church admins can change the giving page web address." };
  }

  const normalized = slugify(slug);
  if (!normalized || normalized.length < 3) {
    return { error: "The web address needs at least 3 letters or numbers." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("churches")
    .select("id")
    .eq("slug", normalized)
    .neq("id", auth.churchId)
    .maybeSingle();

  if (existing?.id) {
    return { error: "Another church already uses that web address. Try a different one." };
  }

  const { error } = await admin
    .from("churches")
    .update({ slug: normalized })
    .eq("id", auth.churchId);

  if (error) {
    return { error: toUserError(error, "We couldn't change your giving page web address.") };
  }

  revalidateGivingDashboard();
  return {};
}

/**
 * Pulls the bank connection's latest state from the payment partner.
 * `chargesEnabled` tells the Giving page whether to move on to choosing funds.
 */
export async function syncStripeAccountStatus(): Promise<{
  error?: string;
  chargesEnabled?: boolean;
}> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) {
    return { error: "Only church admins can check the bank connection." };
  }

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", auth.churchId)
    .single();

  const accountId = church?.stripe_account_id as string | null;
  if (!accountId) {
    return { error: "Your bank isn't connected yet. Choose Connect your bank to start." };
  }

  let account;
  try {
    account = await refreshAccountFromStripe(accountId);
  } catch (error) {
    return { error: toUserError(error, "We couldn't check your bank connection.") };
  }
  revalidateGivingDashboard();
  if (!account) {
    return {
      error:
        "Your bank connection is no longer working. Connect your bank again to keep accepting gifts.",
    };
  }
  return { chargesEnabled: account.charges_enabled === true };
}

export async function updateStatementSettings(params: {
  ein: string | null;
  statementAddress: string | null;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const ein = normalizeEin(params.ein);
  if (!ein.ok) return { error: ein.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("churches")
    .update({
      ein: ein.value,
      statement_address: params.statementAddress?.trim() || null,
    })
    .eq("id", auth.churchId);

  if (error) return { error: toUserError(error, "We couldn't save your statement details.") };
  revalidateGivingDashboard();
  return {};
}

/** Saves only the tax ID, leaving the statement address as it is. */
export async function updateChurchEin(einInput: string): Promise<{ error?: string; ein?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const ein = normalizeEin(einInput);
  if (!ein.ok) return { error: ein.error };
  if (!ein.value) return { error: "Enter your church's tax ID (EIN), like 12-3456789." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("churches")
    .update({ ein: ein.value })
    .eq("id", auth.churchId);

  if (error) return { error: toUserError(error, "We couldn't save your tax ID.") };
  revalidateGivingDashboard();
  return { ein: ein.value };
}

function cleanFundName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function createGivingFund(name: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const cleaned = cleanFundName(name);
  const slug = slugify(cleaned);
  if (!slug) return { error: "Give the fund a name with at least one letter or number." };

  const admin = createAdminClient();
  const { data: maxOrder } = await admin
    .from("giving_funds")
    .select("sort_order")
    .eq("church_id", auth.churchId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("giving_funds").insert({
    church_id: auth.churchId,
    name: cleaned,
    slug,
    sort_order: ((maxOrder?.sort_order as number) ?? 0) + 1,
    is_default: false,
    is_active: true,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: `You already have a fund called ${cleaned}, or one with a very similar name.` };
    }
    return { error: toUserError(error, "We couldn't add that fund.") };
  }
  revalidateGivingDashboard();
  return {};
}

export async function updateGivingFund(
  fundId: string,
  updates: { name?: string },
): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const admin = createAdminClient();
  const row: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    const cleaned = cleanFundName(updates.name);
    const slug = slugify(cleaned);
    if (!slug) return { error: "Give the fund a name with at least one letter or number." };
    row.name = cleaned;
    row.slug = slug;
  }
  if (Object.keys(row).length === 0) return {};

  const { error } = await admin
    .from("giving_funds")
    .update(row)
    .eq("id", fundId)
    .eq("church_id", auth.churchId);

  if (error) {
    if (error.code === "23505") {
      return { error: "You already have a fund with that name. Choose a different name." };
    }
    return { error: toUserError(error, "We couldn't rename that fund.") };
  }
  revalidateGivingDashboard();
  return {};
}

export async function deleteGivingFund(fundId: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const admin = createAdminClient();
  // A giving page always needs somewhere for a gift to go.
  const { count, error: countError } = await admin
    .from("giving_funds")
    .select("id", { count: "exact", head: true })
    .eq("church_id", auth.churchId)
    .eq("is_active", true)
    .neq("id", fundId);
  if (countError) return { error: toUserError(countError, "We couldn't remove that fund.") };
  if ((count ?? 0) < 1) {
    return { error: "Your giving page needs at least one fund. Add another fund before removing this one." };
  }

  const { error } = await admin
    .from("giving_funds")
    .update({ is_active: false })
    .eq("id", fundId)
    .eq("church_id", auth.churchId);

  if (error) return { error: toUserError(error, "We couldn't remove that fund.") };
  revalidateGivingDashboard();
  return {};
}

export async function setDefaultFund(fundId: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const admin = createAdminClient();
  const { error: clearError } = await admin
    .from("giving_funds")
    .update({ is_default: false })
    .eq("church_id", auth.churchId);
  if (clearError) return { error: toUserError(clearError, "We couldn't change the main fund.") };

  const { error } = await admin
    .from("giving_funds")
    .update({ is_default: true })
    .eq("id", fundId)
    .eq("church_id", auth.churchId);

  if (error) return { error: toUserError(error, "We couldn't change the main fund.") };
  revalidateGivingDashboard();
  return {};
}

export async function uploadGivingLogo(
  formData: FormData,
): Promise<{
  error?: string;
  logoUrl?: string;
  suggestedPrimaryColor?: string;
  suggestedAccentColor?: string;
}> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: ADMINS_ONLY };

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { error: "Choose a logo image to upload." };
  const prepared = await prepareChurchLogo(file, formData.get("crop"));
  if (!prepared.ok) return { error: prepared.error };
  const validated = prepared.image;

  const path = `${auth.churchId}/logo.${validated.ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("church-logos")
    .upload(path, validated.buffer, { contentType: validated.contentType, upsert: true });

  if (uploadError) return { error: toUserError(uploadError, "We couldn't upload your logo.") };

  const { data: publicUrl } = admin.storage.from("church-logos").getPublicUrl(path);
  // Same path on every upload: version the URL so a re-framed logo shows.
  const logoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;

  const { error } = await admin
    .from("churches")
    .update({ logo_url: logoUrl })
    .eq("id", auth.churchId);

  if (error) return { error: toUserError(error, "We couldn't save your logo.") };

  await revalidateGivingPaths(auth.churchId);
  const suggestion = await extractLogoTheme(validated.buffer);
  return {
    logoUrl,
    suggestedPrimaryColor: suggestion?.primaryColor,
    suggestedAccentColor: suggestion?.accentColor,
  };
}

export async function updateGivingBranding(params: {
  primaryColor: string | null;
  accentColor: string | null;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Only church admins can change your church's colors." };

  const primary = normalizeHexColor(params.primaryColor);
  const accent = normalizeHexColor(params.accentColor);

  if (params.primaryColor && !primary) {
    return { error: "The main color isn't a color code we recognise. Use one like #002D5F." };
  }
  if (params.accentColor && !accent) {
    return { error: "The accent color isn't a color code we recognise. Use one like #C5A059." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("churches")
    .update({
      giving_primary_color: primary,
      giving_accent_color: accent,
    })
    .eq("id", auth.churchId);

  if (error) return { error: toUserError(error, "We couldn't save your church's colors.") };

  await revalidateGivingPaths(auth.churchId);
  return {};
}

export async function getGivingFundsForSettings(churchId: string) {
  await ensureDefaultFunds(churchId);
  const admin = createAdminClient();
  const { data } = await admin
    .from("giving_funds")
    .select("id, church_id, name, slug, sort_order, is_default, is_active")
    .eq("church_id", churchId)
    .order("sort_order", { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id as string,
    churchId: r.church_id as string,
    name: r.name as string,
    slug: r.slug as string,
    sortOrder: r.sort_order as number,
    isDefault: r.is_default as boolean,
    isActive: r.is_active as boolean,
  }));
}
