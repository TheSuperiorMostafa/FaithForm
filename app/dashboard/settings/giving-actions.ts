"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth } from "@/lib/auth/church";
import { normalizeHexColor } from "@/lib/giving/branding";
import { ensureDefaultFunds } from "@/lib/giving/funds";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccountFromStripe } from "@/lib/stripe/connect";

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
    return { error: "Only church admins can update the giving page URL." };
  }

  const normalized = slugify(slug);
  if (!normalized || normalized.length < 3) {
    return { error: "URL slug must be at least 3 characters." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("churches")
    .select("id")
    .eq("slug", normalized)
    .neq("id", auth.churchId)
    .maybeSingle();

  if (existing?.id) {
    return { error: "This URL is already taken. Choose another slug." };
  }

  const { error } = await admin
    .from("churches")
    .update({ slug: normalized })
    .eq("id", auth.churchId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/giving");
  return {};
}

export async function syncStripeAccountStatus(): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) {
    return { error: "Forbidden" };
  }

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", auth.churchId)
    .single();

  const accountId = church?.stripe_account_id as string | null;
  if (!accountId) {
    return { error: "No Stripe account linked." };
  }

  await refreshAccountFromStripe(accountId);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/giving");
  return {};
}

export async function updateStatementSettings(params: {
  ein: string | null;
  statementAddress: string | null;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("churches")
    .update({
      ein: params.ein,
      statement_address: params.statementAddress,
    })
    .eq("id", auth.churchId);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/giving/statements");
  return {};
}

export async function createGivingFund(name: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const slug = slugify(name);
  if (!slug) return { error: "Invalid fund name" };

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
    name,
    slug,
    sort_order: ((maxOrder?.sort_order as number) ?? 0) + 1,
    is_default: false,
    is_active: true,
  });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/giving");
  return {};
}

export async function updateGivingFund(
  fundId: string,
  updates: { name?: string },
): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const admin = createAdminClient();
  const row: Record<string, unknown> = {};
  if (updates.name) {
    row.name = updates.name;
    row.slug = slugify(updates.name);
  }

  const { error } = await admin
    .from("giving_funds")
    .update(row)
    .eq("id", fundId)
    .eq("church_id", auth.churchId);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings");
  return {};
}

export async function deleteGivingFund(fundId: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("giving_funds")
    .update({ is_active: false })
    .eq("id", fundId)
    .eq("church_id", auth.churchId);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings");
  return {};
}

export async function setDefaultFund(fundId: string): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const admin = createAdminClient();
  await admin
    .from("giving_funds")
    .update({ is_default: false })
    .eq("church_id", auth.churchId);

  const { error } = await admin
    .from("giving_funds")
    .update({ is_default: true })
    .eq("id", fundId)
    .eq("church_id", auth.churchId);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings");
  return {};
}

export async function uploadGivingLogo(
  formData: FormData,
): Promise<{ error?: string; logoUrl?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };
  if (file.size > 2 * 1024 * 1024) return { error: "Logo must be 2MB or smaller." };

  const allowed = ["image/png", "image/jpeg", "image/jpg"];
  if (!allowed.includes(file.type)) return { error: "Logo must be PNG or JPG." };

  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${auth.churchId}/logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("church-logos")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadError) return { error: uploadError.message };

  const { data: publicUrl } = admin.storage.from("church-logos").getPublicUrl(path);
  const logoUrl = publicUrl.publicUrl;

  const { error } = await admin
    .from("churches")
    .update({ logo_url: logoUrl })
    .eq("id", auth.churchId);

  if (error) return { error: error.message };

  await revalidateGivingPaths(auth.churchId);
  return { logoUrl };
}

export async function updateGivingBranding(params: {
  primaryColor: string | null;
  accentColor: string | null;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const primary = normalizeHexColor(params.primaryColor);
  const accent = normalizeHexColor(params.accentColor);

  if (params.primaryColor && !primary) {
    return { error: "Primary color must be a valid hex value (e.g. #1A2B4B)." };
  }
  if (params.accentColor && !accent) {
    return { error: "Accent color must be a valid hex value (e.g. #C19A6B)." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("churches")
    .update({
      giving_primary_color: primary,
      giving_accent_color: accent,
    })
    .eq("id", auth.churchId);

  if (error) return { error: error.message };

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
