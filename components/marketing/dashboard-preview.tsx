import Image from "next/image";
import { BookOpen, ClipboardCheck, House, Megaphone, Users } from "lucide-react";
import { QuickActionsSection } from "@/components/dashboard/quick-actions-section";
import { Skeleton } from "@/components/ui/skeleton";

const previewNav = [
  { label: "Home", icon: House },
  { label: "Attendance", icon: ClipboardCheck },
  { label: "Announcements", icon: Megaphone },
  { label: "Sermons", icon: BookOpen },
  { label: "People", icon: Users },
] as const;

/** Reuses the production dashboard's QuickActionsSection with no invented data. */
export function DashboardPreview({ loading = false }: { loading?: boolean }) {
  return (
    <div className="marketing-dashboard-frame" role="img" aria-label="FaithForm pastor dashboard preview showing an illustrative 12.5 hours saved and weekly tools for announcements, attendance, and sermons">
      <div aria-hidden="true" className="marketing-dashboard-top"><span className="marketing-dashboard-dots"><i /><i /><i /></span><span>FaithForm / Dashboard</span><span className="marketing-dashboard-top-mark">faithform.io</span></div>
      <div aria-hidden="true" className="marketing-dashboard-body">
        <div className="marketing-dashboard-rail" aria-hidden="true">
          <Image src="/faithform-logo.png" width={31} height={31} alt="" />
          {previewNav.map(({ label, icon: Icon }, index) => <span className={index === 0 ? "is-current" : ""} key={label} title={label}><Icon size={18} strokeWidth={1.8} /></span>)}
        </div>
        <div className="marketing-dashboard-content">
          <div className="marketing-dashboard-kicker">PASTOR&apos;S WEB DASHBOARD</div>
          <div className="marketing-dashboard-content-head"><h2>Home</h2><span>Weekly tools</span></div>
          <div className="marketing-dashboard-context"><div className="marketing-dashboard-context-copy"><strong>Hours saved</strong><p>Example dashboard total</p></div><div className="marketing-dashboard-context-value">{loading ? <Skeleton className="h-9 w-28 rounded-md" /> : <>12.5<span>hrs</span></>}</div></div>
          <h3 className="marketing-dashboard-section-title">Your Weekly Inputs</h3>
          {loading ? (
            <div className="marketing-dashboard-loading-grid">{[0, 1, 2].map((i) => <div key={i}><Skeleton className="mx-auto mb-4 size-11 rounded-xl" /><Skeleton className="mx-auto mb-2 h-4 w-24" /><Skeleton className="mx-auto h-3 w-16" /></div>)}</div>
          ) : (
            <>
              <div className="marketing-dashboard-real-actions" inert aria-hidden="true"><QuickActionsSection churchId="" allowedFeatures={["announcements", "attendance", "sermon_builder"]} /></div>
              <div className="marketing-dashboard-mobile-action" inert aria-hidden="true"><QuickActionsSection churchId="" allowedFeatures={["announcements"]} /></div>
            </>
          )}
        </div>
      </div>
      <div aria-hidden="true" className="marketing-dashboard-caption">Actual dashboard tools · Illustrative hours-saved total</div>
    </div>
  );
}
