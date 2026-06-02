import Link from "next/link";
import { getChurchBySlug } from "@/lib/queries/giving";

type PageProps = {
  params: { slug: string };
};

export default async function ThankYouPage({ params }: PageProps) {
  const church = await getChurchBySlug(params.slug);

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/20 text-2xl">
        ✓
      </div>
      <h1 className="font-heading text-2xl font-bold">Thank you!</h1>
      <p className="text-sm text-muted-foreground">
        Your gift{church ? ` to ${church.churchName}` : ""} was received. A receipt
        will be emailed if you provided an address.
      </p>
      {church && (
        <Link
          href={`/give/${church.slug}`}
          className="inline-block text-sm font-medium text-accent hover:underline"
        >
          Give again
        </Link>
      )}
    </div>
  );
}
