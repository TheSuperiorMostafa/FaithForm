import type { ReactNode } from "react";
import { SectionLinkTabs } from "@/components/dashboard/section-link-tabs";

const liveStreamTabs = [
  {
    label: "Stream",
    href: "/dashboard/live-streaming",
    isActive: (pathname: string) => pathname === "/dashboard/live-streaming",
  },
  {
    label: "Media",
    href: "/dashboard/live-streaming/media",
    isActive: (pathname: string) =>
      pathname.startsWith("/dashboard/live-streaming/media"),
  },
];

export default function LiveStreamingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Live Stream
        </h1>
      </header>

      <SectionLinkTabs tabs={liveStreamTabs} />

      {children}
    </div>
  );
}
