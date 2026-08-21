import type { Metadata } from "next";
import { getChurchBySlug } from "@/lib/queries/giving";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
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
