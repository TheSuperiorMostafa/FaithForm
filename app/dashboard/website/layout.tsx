import type { ReactNode } from "react";

import { FeatureGate } from "@/components/dashboard/feature-gate";
import { SectionLinkTabs } from "@/components/dashboard/section-link-tabs";

const TABS = [
  { label: "Overview", href: "/dashboard/website", match: "exact" as const },
  { label: "Pages", href: "/dashboard/website/pages" },
  { label: "Details", href: "/dashboard/website/details" },
  { label: "Design", href: "/dashboard/website/design" },
  { label: "Sermons", href: "/dashboard/website/sermons" },
  { label: "Messages", href: "/dashboard/website/messages" },
  { label: "Domain", href: "/dashboard/website/domain" },
];

export default function WebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="website">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
            Website
          </h1>
          <p className="text-sm text-muted-foreground">
            Your public church website — content, design, sermons, and the
            messages visitors send you.
          </p>
        </div>

        <SectionLinkTabs tabs={TABS} />

        {children}
      </div>
    </FeatureGate>
  );
}
