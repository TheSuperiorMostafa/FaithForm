import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function Loading() {
  return <SkeletonContainer label="Churches" className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <PageHeader title="Churches" description="Search, sort, and inspect every church workspace." action={<span className="inline-flex min-h-11 items-center rounded-[10px] bg-primary px-6 font-semibold text-primary-foreground">Add Church</span>} />
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Churches</h2><p className="text-sm text-muted-foreground">Search and sort every tenant on the platform.</p></div><Skeleton className="h-11 w-full sm:w-80" /></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground"><tr>{["Church", "Health status", "Onboarding", "Users", "Google", "Facebook", "Giving", "Sermons", "Last active", "Joined", "Actions"].map(label => <th key={label} className="px-5 py-4 text-left">{label}</th>)}</tr></thead><tbody>{Array.from({ length: 6 }, (_, row) => <tr key={row} className="even:bg-background/60">{Array.from({ length: 11 }, (_, col) => <td key={col} className={`px-5 py-4 ${col === 1 ? "min-w-52 space-y-2" : ""}`}><Skeleton className={col === 1 ? "h-7 w-32 rounded-full" : "h-5 w-20"} />{col === 1 && <><Skeleton className="h-10 w-44" /><span className="inline-flex min-h-11 items-center px-6 font-semibold">Update health</span></>}</td>)}</tr>)}</tbody></table></div>
    </Card>
  </SkeletonContainer>;
}
