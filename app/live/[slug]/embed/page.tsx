import { notFound } from "next/navigation";
import { PublicWatchClient } from "@/components/live-streaming/public-watch-client";
import { getChurchBySlug } from "@/lib/queries/giving";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function LiveEmbedPage({ params }: PageProps) {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
  if (!church) notFound();

  return <PublicWatchClient slug={church.slug} embed />;
}
