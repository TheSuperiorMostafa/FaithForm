"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/activity/admin-log";
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

/**
 * Records that we checked a church's Candid Seal of Transparency, or withdraws
 * that record.
 *
 * Apple allows a donation inside the iPhone app without In-App Purchase only
 * when it is paid with Apple Pay *and* the receiving nonprofit is one Apple has
 * approved (guideline 3.2.1(vi)). The receiving nonprofit is the church, not
 * FaithForm, so this is decided per church, and until it is set the iPhone app
 * sends a giver to the church's web give page in Safari instead.
 *
 * Platform admins only, and written with the service role: migration 0072's
 * trigger refuses the same change from a church's own session, because the flag
 * is our attestation rather than the church's claim.
 */
export async function setChurchApplePayDonationsApproval(
  churchId: string,
  approved: boolean,
): Promise<{ approvedAt?: string | null; error?: string }> {
  await requireSuperAdmin();

  if (!churchId) return { error: "Missing church." };

  // Stamped here rather than by a database default so the constraint that keeps
  // the flag and its date together is satisfied by one write, and a revocation
  // clears the date instead of leaving an "approved since" behind it.
  const approvedAt = approved ? new Date().toISOString() : null;

  const admin = createAdminClient();
  const { error } = await admin
    .from("churches")
    .update({
      apple_pay_donations_approved: approved,
      apple_pay_donations_approved_at: approvedAt,
    })
    .eq("id", churchId);

  if (error) {
    // PostgREST's "schema cache" wording sounds like a caching blip. Say which
    // migration is missing, the way the feature toggles do.
    if (/apple_pay_donations_approved/i.test(error.message)) {
      return {
        error:
          "In-app giving approval isn't set up in this database yet — migration 0072 hasn't been applied.",
      };
    }
    return { error: error.message };
  }

  await logAdminAction({
    churchId,
    taskName: approved
      ? "Candid Seal verified — in-app Apple Pay giving allowed on iPhone"
      : "In-app Apple Pay giving approval withdrawn",
    triggerSource: "Control center",
  });

  revalidatePath(`/admin/churches/${churchId}`);
  return { approvedAt };
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
