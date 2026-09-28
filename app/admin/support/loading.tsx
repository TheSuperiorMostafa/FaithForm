import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonContainer label="Support" className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader title="Support" description="Track platform support tickets across all churches." action={<Button disabled>New Ticket</Button>} />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Tickets</h2>
            <p className="text-sm text-muted-foreground">Filter platform support by status, priority, and email alert.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {["All statuses", "All priorities", "All email alerts"].map((label) => (
              <div key={label} className="min-h-11 rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-muted-foreground">{label}</div>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
              <tr>{["Subject", "Church", "Priority", "Status", "Email alert", "Submitted by", "Created"].map((heading) => <th key={heading} className="px-5 py-4 text-left">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="even:bg-background/60">
                  {["w-36", "w-28", "w-16", "w-16", "w-24", "w-32", "w-20"].map((width, cell) => (
                    <td key={cell} className="px-5 py-4"><Skeleton className={`${width} h-4`} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </SkeletonContainer>
  );
}
