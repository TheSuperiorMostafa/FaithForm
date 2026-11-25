import { createBillingPortalSession } from "@/lib/stripe/giving";
import { getGivePageUrl } from "@/lib/stripe/config";
import { getChurchBySlug } from "@/lib/queries/giving";
import { createAdminClient } from "@/lib/supabase/admin";

export type VerifiedDonorPortalSession = {
  churchId: string;
  donorId: string;
  sessionId: string;
};

type PortalChurch = {
  churchId: string;
  slug: string;
  stripeAccountId: string | null;
};

export type BillingPortalDependencies = {
  loadChurch: (slug: string) => Promise<PortalChurch | null>;
  loadActiveCustomerId: (
    churchId: string,
    donorId: string,
  ) => Promise<string | null>;
  createPortal: (
    accountId: string,
    customerId: string,
    returnUrl: string,
  ) => Promise<string>;
  /**
   * The connected account a donor's customer lives on. A customer on a fund's
   * own account cannot be opened through the church's main account. Absent or
   * null means the main account, where every customer before 0182 lives.
   */
  loadCustomerAccountId?: (
    churchId: string,
    donorId: string,
    customerId: string,
  ) => Promise<string | null>;
};

const dependencies: BillingPortalDependencies = {
  loadChurch: getChurchBySlug,
  async loadActiveCustomerId(churchId, donorId) {
    const { data } = await createAdminClient()
      .from("giving_subscriptions")
      .select("stripe_customer_id")
      .eq("church_id", churchId)
      .eq("donor_id", donorId)
      .in("status", ["active", "past_due", "trialing"])
      .limit(1)
      .maybeSingle();
    return (data?.stripe_customer_id as string | undefined) ?? null;
  },
  createPortal: createBillingPortalSession,
  async loadCustomerAccountId(churchId, donorId, customerId) {
    const { data, error } = await createAdminClient()
      .from("giving_subscriptions")
      .select("stripe_account_id")
      .eq("church_id", churchId)
      .eq("donor_id", donorId)
      .eq("stripe_customer_id", customerId)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data?.stripe_account_id as string | null) ?? null;
  },
};

export async function createAuthorizedBillingPortal(
  slug: string,
  session: VerifiedDonorPortalSession,
  deps: BillingPortalDependencies = dependencies,
): Promise<string | null> {
  const church = await deps.loadChurch(slug);
  if (
    !church?.stripeAccountId ||
    church.churchId !== session.churchId ||
    church.slug !== slug
  ) {
    return null;
  }

  const customerId = await deps.loadActiveCustomerId(
    session.churchId,
    session.donorId,
  );
  if (!customerId) return null;

  const customerAccountId = deps.loadCustomerAccountId
    ? await deps.loadCustomerAccountId(session.churchId, session.donorId, customerId)
    : null;

  return deps.createPortal(
    customerAccountId ?? church.stripeAccountId,
    customerId,
    `${getGivePageUrl(slug)}/manage`,
  );
}
