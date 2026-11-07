import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
export default function Loading() {
  return <SkeletonContainer label="Record donations" className="flex w-full flex-col gap-8">
    <PageHeader title="Record donations" description="Record gifts already received in cash, by check or outside FaithForm." />
    <Card className="space-y-6 p-6"><h2 className="text-xl font-semibold">Add a donation</h2>
      <div className="grid gap-5 sm:grid-cols-2">{["Date", "Amount ($)", "Fund", "Donor", "Donor name", "Donor email", "Payment method"].map(label => <div key={label} className="space-y-2"><span>{label}</span><Skeleton className="h-11 w-full" /></div>)}</div>
      <Skeleton className="h-11 w-40" />
    </Card>
    <Card className="space-y-5 p-6"><h2 className="text-xl font-semibold">Import a spreadsheet</h2><p>Choose an Excel (.xlsx) or CSV file with up to 500 donations.</p><Skeleton className="h-11 w-full" /></Card>
  </SkeletonContainer>;
}
