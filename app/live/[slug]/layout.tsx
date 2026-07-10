import type { Metadata } from "next";
import { getChurchBySlug } from "@/lib/queries/giving";

type LayoutProps = {
  children: React.ReactNode;
  params: { slug: string };
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const church = await getChurchBySlug(params.slug);
  return {
    title: church ? `Live — ${church.churchName}` : "Live | FaithForm",
    description: church
      ? `Watch ${church.churchName} live on FaithForm`
      : "Watch live on FaithForm",
  };
}

export default function LiveLayout({ children }: LayoutProps) {
  return children;
}
