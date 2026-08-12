import { notFound } from "next/navigation";
import { GiveForm } from "@/app/give/[slug]/give-form";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { getActiveFundsForChurch } from "@/lib/giving/funds";
import { getChurchBySlug } from "@/lib/queries/giving";

type PageProps = {
  params: { slug: string };
  searchParams?: { amount?: string };
};

/**
 * `?amount=` carries a gift picked on the church's own website. Untrusted
 * input, so it is clamped to a sane range and rounded to whole cents before it
 * ever reaches the form; anything unparseable just falls back to the default.
 */
function parseAmountCents(raw: string | undefined): number | undefined {
  if (!raw) return undefined;

  const dollars = Number.parseFloat(raw);
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 100_000) {
    return undefined;
  }

  return Math.round(dollars * 100);
}

export default async function GivePage({ params, searchParams }: PageProps) {
  const church = await getChurchBySlug(params.slug);

  if (!church) {
    notFound();
  }

  // Giving switched off in the control center stops the public page too.
  // The soft message below is for a church that has not finished Stripe setup;
  // this is a deliberate switch-off, and a "check back soon" would invite a
  // donor to keep trying something we turned off on purpose.
  if (!(await isChurchFeatureEnabled(church.churchId, "giving"))) {
    notFound();
  }

  if (!church.stripeChargesEnabled || !church.stripeAccountId) {
    return (
      <div className="text-center">
        <h1 className="font-heading text-xl font-bold">{church.churchName}</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Online giving is not available yet. Please check back soon.
        </p>
      </div>
    );
  }

  const funds = await getActiveFundsForChurch(church.churchId);

  return (
    <GiveForm
      slug={church.slug}
      churchName={church.churchName}
      stripeAccountId={church.stripeAccountId}
      logoUrl={church.logoUrl}
      givingPrimaryColor={church.givingPrimaryColor}
      funds={funds}
      initialAmountCents={parseAmountCents(searchParams?.amount)}
    />
  );
}
