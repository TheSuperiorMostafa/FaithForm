import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

export default function ChurchSiteLoading() {
  return (
    <div className="site-page">
      <div data-site="loading">
        <SkeletonContainer label="Church website">
          <div className="site-nav site-nav-static"><div className="site-nav-inner">
            <Skeleton className="h-11 w-44" />
            <Skeleton className="h-11 w-24" />
          </div></div>
          <div className="site-section site-surface-canvas site-page-intro">
            <div>
              <Skeleton className="mb-6 h-11 w-16" />
              <Skeleton className="mb-5 h-4 w-52" />
              <Skeleton className="h-14 w-4/5" />
              <SkeletonText lines={2} size="lg" className="mt-6 max-w-md" />
              <div className="site-page-contents"><Skeleton className="h-11 w-32" /><Skeleton className="h-11 w-32" /></div>
            </div>
            <Skeleton className="site-page-intro-photo" />
          </div>
          <div className="site-section site-surface-canvas-alt">
            <Skeleton className="h-10 w-60" />
            <div className="site-page-cards">
              {[0, 1, 2].map((index) => <div key={index} className="site-page-card"><Skeleton className="mb-6 h-8 w-3/5" /><SkeletonText lines={4} /></div>)}
            </div>
          </div>
        </SkeletonContainer>
      </div>
    </div>
  );
}
