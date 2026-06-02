"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { getAdminChurchStripeAccountId } from "@/lib/queries/admin-giving";
import { createLoginLink } from "@/lib/stripe/connect";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/stripe/client";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function updateAdminChurchSlug(
  churchId: string,
  slug: string,
): Promise<{ error?: string }> {
  await requireSuperAdmin();

  const normalized = slugify(slug);
  if (!normalized || normalized.length < 3) {
    return { error: "Slug must be at least 3 characters." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("churches")
    .select("id")
    .eq("slug", normalized)
    .neq("id", churchId)
    .maybeSingle();

  if (existing?.id) {
    return { error: "Slug already in use." };
  }

  const { error } = await admin
    .from("churches")
    .update({ slug: normalized })
    .eq("id", churchId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/churches/${churchId}`);
  revalidatePath("/admin/churches");
  return {};
}

export async function openStripeDashboardForChurch(
  churchId: string,
): Promise<{ url?: string; error?: string }> {
  await requireSuperAdmin();

  if (!isStripeConfigured()) {
    return { error: "Stripe is not configured." };
  }

  const accountId = await getAdminChurchStripeAccountId(churchId);
  if (!accountId) {
    return { error: "No Stripe account for this church." };
  }

  try {
    const url = await createLoginLink(accountId);
    return { url };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not open Stripe";
    return { error: message };
  }
}
