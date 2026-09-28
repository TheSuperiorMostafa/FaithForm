import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarketingLanding } from "@/components/marketing/landing";
import { CurrentHero } from "@/components/marketing/current-hero";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { FutureVideoHero } from "@/components/marketing/future-video-hero";
import { marketingConfig } from "@/components/marketing/config";
import "./marketing.css";

export const metadata: Metadata = {
  title: "FaithForm | Give pastors their time back",
  description: "Church software that gets out of the way. FaithForm helps pastors spend fewer hours on admin and more hours on ministry.",
  openGraph: {
    title: "FaithForm | Give pastors their time back",
    description: "It's time to stop punching your computer. Fewer hours on admin, more hours on ministry.",
    type: "website",
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const query = await searchParams;
  // Keep the root fallback for auth links when Supabase strips redirect_to.
  if (typeof query.code === "string" || typeof query.error_description === "string") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") params.set(key, value);
    }
    redirect(`/auth/callback?${params.toString()}`);
  }

  const video = marketingConfig.walkthrough;
  const hero = video.enabled && video.src
    ? <FutureVideoHero src={video.src} poster={video.poster} captions={video.captions} />
    : <CurrentHero preview={<DashboardPreview />} />;
  return <MarketingLanding hero={hero} />;
}
