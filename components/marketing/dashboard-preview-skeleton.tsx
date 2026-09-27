import Image from "next/image";
import { ArrowRight, BookOpen, ClipboardCheck, Heart, House, Megaphone, Radio, Users } from "lucide-react";

const tabs = [
  { label: "Home", icon: House },
  { label: "Sermons", icon: BookOpen },
  { label: "Announcements", icon: Megaphone },
  { label: "Go live", icon: Radio },
  { label: "Attendance", icon: ClipboardCheck },
  { label: "People", icon: Users },
  { label: "Giving", icon: Heart },
] as const;

/** The hero's streaming fallback keeps the same window and static text in place. */
export function DashboardPreviewSkeleton() {
  return (
    <div className="marketing-dashboard-frame" aria-label="FaithForm dashboard preview loading">
      <div className="marketing-dashboard-top"><span className="marketing-dashboard-dots" aria-hidden="true"><i /><i /><i /></span><span>FaithForm / Pastor dashboard</span><span className="marketing-dashboard-top-mark">faithform.io</span></div>
      <div className="marketing-dashboard-body">
        <div className="marketing-dashboard-rail" aria-hidden="true">
          <Image src="/faithform-logo.png" width={31} height={31} alt="" />
          {tabs.map(({ label, icon: Icon }, index) => <button key={label} type="button" disabled className={index === 0 ? "is-current" : ""}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></button>)}
        </div>
        <div className="marketing-dashboard-content">
          <div className="marketing-dashboard-kicker">YOUR WEEK, SIMPLIFIED</div>
          <div className="marketing-dashboard-content-head"><h2>Good morning, Pastor.</h2><span className="marketing-demo-pill">Overview</span></div>
          <p className="marketing-demo-intro">One place for the work that keeps your church moving.</p>
          <div className="marketing-dashboard-context"><div className="marketing-dashboard-context-copy"><strong>Hours saved</strong><p>Illustrative weekly total</p><p className="marketing-dashboard-context-added">Try a tool to add time back</p></div><div className="marketing-dashboard-context-value"><b>12</b><span>h</span><b>30</b><span>m</span></div></div>
          <h3 className="marketing-dashboard-section-title">Your weekly tools</h3>
          <div className="marketing-demo-home-actions" aria-hidden="true">
            <button type="button" disabled><BookOpen size={19} /><span><strong>Build a sermon</strong><small>Passage to presentation</small></span><ArrowRight size={15} /></button>
            <button type="button" disabled><Megaphone size={19} /><span><strong>Make an announcement</strong><small>Graphic to channels</small></span><ArrowRight size={15} /></button>
            <button type="button" disabled><Users size={19} /><span><strong>Care for your people</strong><small>Visits to follow-up</small></span><ArrowRight size={15} /></button>
          </div>
        </div>
      </div>
      <div className="marketing-dashboard-caption"><span>More time for what matters.</span><span>faithform.io</span></div>
    </div>
  );
}
