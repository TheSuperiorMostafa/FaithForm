"use client";

import { usePathname } from "next/navigation";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { websitePageDefForPath } from "@/lib/sites/layout-mode";

/** Reserve the shape of the requested page rather than a full home-page hero. */
export default function ChurchSiteLoading() {
  const pathname = usePathname();
  const path = pathname.match(/^\/sites\/[^/]+(.*)$/)?.[1] || pathname;
  const definition = websitePageDefForPath(path);
  const cards = path === "/staff" || path === "/programs" || path === "/sermons" || path === "/events";
  return (
    <div className="site-page" data-layout={definition ? "website" : "landing"}>
      <div data-site="loading">
        <SkeletonContainer label="Church website">
          <div className="site-nav site-nav-static"><div className="site-nav-inner">
            <Skeleton className="h-11 w-44" /><Skeleton className="h-11 w-24" />
          </div></div>
          <div className="site-section site-surface-canvas site-page-intro" data-page={path}>
            <div>
              {definition ? <Skeleton className="mb-3 h-11 w-16" /> : null}
              <Skeleton className="mb-5 h-4 w-52" />
              <Skeleton className="h-14 w-4/5" />
              <SkeletonText lines={2} size="lg" className="mt-4 max-w-md" />
            </div>
            {path === "/visit" ? <div className="site-page-visit-details"><Skeleton className="mb-4 h-8 w-48" /><SkeletonText lines={2} /><Skeleton className="mt-4 h-12 w-44" /></div> : !definition || path === "/about" ? <Skeleton className="site-page-intro-photo" /> : null}
          </div>
          <div className="site-section site-surface-canvas-alt">
            {path === "/visit" ? <div className="mb-8 flex flex-wrap gap-4">{[0, 1].map(i => <Skeleton key={i} className="h-24 w-60" />)}</div> : null}
            <Skeleton className="mb-6 h-10 w-60" />
            {cards ? <div className="site-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
              {[0, 1, 2].map(i => <div key={i} className="site-card"><Skeleton className="mb-4 aspect-video w-full" /><Skeleton className="mb-4 h-7 w-3/5" /><SkeletonText lines={3} /></div>)}
            </div> : <div className="site-split"><SkeletonText lines={4} /><div className="site-panel"><Skeleton className="mb-5 h-10 w-2/3" /><SkeletonText lines={3} /><Skeleton className="mt-6 h-12 w-full" /></div></div>}
          </div>
        </SkeletonContainer>
      </div>
    </div>
  );
}
