import { notFound } from "next/navigation";
import { GiveForm } from "@/app/give/[slug]/give-form";
import { getActiveFundsForChurch } from "@/lib/giving/funds";
import { getChurchBySlug } from "@/lib/queries/giving";

type PageProps = {
  params: { slug: string };
};

export default async function GivePage({ params }: PageProps) {
  const church = await getChurchBySlug(params.slug);

  if (!church) {
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
    />
  );
}
