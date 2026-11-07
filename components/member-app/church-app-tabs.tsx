"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "look-name", label: "Look & name", path: "/dashboard/app" },
  { id: "about", label: "About", path: "/dashboard/app/about" },
  { id: "service-times", label: "Service times", path: "/dashboard/app/service-times" },
  { id: "location-contact", label: "Location & contact", path: "/dashboard/app/location-contact" },
  { id: "social", label: "Social", path: "/dashboard/app/social" },
  { id: "links", label: "Links", path: "/dashboard/app/links" },
];

export function ChurchAppTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Church App settings sections" className="border-b border-border">
      <div className="flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const isActive = pathname === tab.path;
          return (
            <Link
              key={tab.id}
              href={tab.path}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 border-transparent px-4 text-[15px] font-semibold transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
