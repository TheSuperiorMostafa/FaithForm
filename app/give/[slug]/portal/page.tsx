import { redirect } from "next/navigation";
import { PortalDashboard } from "@/app/give/[slug]/portal/portal-dashboard";
import { PortalLogin } from "@/app/give/[slug]/portal/portal-login";
import {
  consumeMagicLinkToken,
  getDonorPortalSession,
} from "@/lib/giving/portal-session";
import { getActiveFundsForChurch } from "@/lib/giving/funds";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChurchBySlug } from "@/lib/queries/giving";

export const dynamic = "force-dynamic";

function fundNameFromJoin(
  fund: { name: string } | { name: string }[] | null | undefined,
): string {
  if (!fund) return "General";
  if (Array.isArray(fund)) return fund[0]?.name ?? "General";
  return fund.name;
}

type PageProps = {
  params: { slug: string };
  searchParams: { token?: string };
};

export default async function PortalPage({ params, searchParams }: PageProps) {
  const church = await getChurchBySlug(params.slug);
  if (!church) {
    return <p className="text-sm text-muted-foreground">Church not found.</p>;
  }

  if (searchParams.token) {
    const consumed = await consumeMagicLinkToken(
      searchParams.token,
      params.slug,
    );
    if (consumed) {
      redirect(`/give/${params.slug}/portal`);
    }
  }

  const session = await getDonorPortalSession(params.slug);

  if (!session) {
    return (
      <PortalLogin
        slug={params.slug}
        churchName={church.churchName}
        logoUrl={church.logoUrl}
      />
    );
  }

  const admin = createAdminClient();
  const { data: donor } = await admin
    .from("giving_donors")
    .select("name, email, stripe_customer_id")
    .eq("id", session.donorId)
    .single();

  const { data: subscriptions } = await admin
    .from("giving_subscriptions")
    .select(
      `id, amount_cents, currency, interval, status, paused_at,
       giving_funds ( name )`,
    )
    .eq("church_id", session.churchId)
    .eq("donor_id", session.donorId)
    .order("created_at", { ascending: false });

  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1).toISOString();

  const { data: gifts } = await admin
    .from("giving_donations")
    .select(
      `id, amount_cents, currency, status, gift_type, created_at,
       giving_funds ( name )`,
    )
    .eq("church_id", session.churchId)
    .eq("donor_id", session.donorId)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: yearGifts } = await admin
    .from("giving_donations")
    .select("id")
    .eq("church_id", session.churchId)
    .eq("donor_id", session.donorId)
    .eq("status", "succeeded")
    .gte("created_at", yearStart);

  const funds =
    church.stripeChargesEnabled && church.stripeAccountId
      ? await getActiveFundsForChurch(church.churchId)
      : [];

  return (
    <PortalDashboard
      slug={params.slug}
      churchName={church.churchName}
      stripeAccountId={church.stripeAccountId ?? ""}
      logoUrl={church.logoUrl}
      givingPrimaryColor={church.givingPrimaryColor}
      funds={funds}
      givingEnabled={Boolean(church.stripeChargesEnabled && church.stripeAccountId)}
      donor={{
        name: (donor?.name as string) ?? null,
        email: (donor?.email as string) ?? "",
        hasStripeCustomer: Boolean(donor?.stripe_customer_id),
      }}
      subscriptions={(subscriptions ?? []).map((s) => ({
        id: s.id as string,
        amountCents: s.amount_cents as number,
        currency: s.currency as string,
        interval: s.interval as string,
        status: s.status as string,
        fundName: fundNameFromJoin(s.giving_funds),
        pausedAt: (s.paused_at as string) ?? null,
      }))}
      gifts={(gifts ?? []).map((g) => ({
        id: g.id as string,
        amountCents: g.amount_cents as number,
        currency: g.currency as string,
        status: g.status as string,
        giftType: g.gift_type as string,
        fundName: fundNameFromJoin(g.giving_funds),
        createdAt: g.created_at as string,
      }))}
      yearGiftCount={yearGifts?.length ?? 0}
      donorId={session.donorId}
      year={year}
    />
  );
}
