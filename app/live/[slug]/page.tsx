import { notFound } from "next/navigation";
import { PublicWatchClient } from "@/components/live-streaming/public-watch-client";
import { getChurchBySlug } from "@/lib/queries/giving";

type PageProps = {
  params: { slug: string };
};

export default async function LiveWatchPage({ params }: PageProps) {
  const church = await getChurchBySlug(params.slug);
  if (!church) notFound();

  return <PublicWatchClient slug={church.slug} />;
}
