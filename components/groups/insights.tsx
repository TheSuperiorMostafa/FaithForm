"use client";
import Link from "next/link";
import type { ChurchGroupSummary, GroupHealthRow, WeeklyPoint } from "@/lib/groups/staff/insights";
import { base, Empty, Stat, Tag } from "./shared";

export function Insights({ summary, trend, health }: { summary: ChurchGroupSummary; trend: WeeklyPoint[]; health: GroupHealthRow[] }) {
  const max = Math.max(1, ...trend.map(p => p.present + p.guests));
  const week = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return <div className="flex flex-col gap-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat title="People in groups" value={summary.peopleInGroups} hint="Different people across all active groups" />
      <Stat title="Joined a group" value={summary.joinedInWindow} hint="In the last 30 days" />
      <Stat title="Average attendance" value={summary.averageAttendance ?? "Not yet"} hint="People and guests at each meeting with attendance taken" />
      <Stat title="Showed up" value={summary.attendanceRate === null ? "Not yet" : `${Math.round(summary.attendanceRate * 100)}%`} hint="Of members expected at those meetings" />
    </div>
    <section className="g-panel space-y-5" aria-labelledby="trend-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="trend-title">Attendance each week</h2><p className="g-row-sub">The last 12 weeks, members and guests together.</p></div><Tag>Members + guests</Tag></div>
      {trend.some(p => p.gatherings) ? <>
        <div className="g-chart" role="img" aria-label="Weekly attendance for the last 12 weeks. The numbers are listed below the chart.">{trend.map(p => <div className="g-chart-column" key={p.weekStart}><div className="g-chart-bar" style={{ height: `${(p.present + p.guests) / max * 140}px` }} /><small>{week(p.weekStart)}</small></div>)}</div>
        <details className="g-details"><summary>Show the numbers</summary><ul className="mt-3 grid grid-cols-2 gap-2 text-[15px] sm:grid-cols-3">{trend.map(p => <li key={p.weekStart}>Week of {week(p.weekStart)}: {p.present + p.guests}</li>)}</ul></details>
      </> : <Empty icon="events" compact title="No attendance yet" description="Take attendance at a group meeting and it will show here." />}
    </section>
    <section className="g-panel space-y-5" aria-labelledby="health-title">
      <div><h2 id="health-title">Each group, last 30 days</h2><p className="g-row-sub">Meetings without attendance taken are left out.</p></div>
      {health.length ? <div className="g-table-wrap"><table className="g-table"><thead><tr><th scope="col">Group</th><th scope="col">People</th><th scope="col">Meetings</th><th scope="col">Showed up</th><th scope="col">Chat messages</th></tr></thead><tbody>{health.map(g => <tr key={g.groupId}><td><Link href={`${base}/${g.groupId}`} className="font-semibold underline-offset-4 hover:underline">{g.name}</Link></td><td>{g.memberCount}</td><td>{g.gatheringsRecorded}</td><td>{g.attendanceRate === null ? "Not taken" : `${Math.round(g.attendanceRate * 100)}%`}</td><td>{g.messages30d}</td></tr>)}</tbody></table></div> : <p className="text-[15px] text-muted-foreground">Your active groups will show here.</p>}
    </section>
  </div>;
}
