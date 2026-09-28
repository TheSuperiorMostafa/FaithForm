import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonContainer label="Support ticket" className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <Skeleton className="h-9 w-64 border-l-4 border-accent" />
        <p className="mt-1 text-sm text-muted-foreground">Review the ticket, reply to the church, and set its status.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle>Ticket details</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="flex gap-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-20" /></div>
            <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Body</p><SkeletonText lines={3} size="sm" className="mt-2" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Context</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {["Church", "Submitted by", "Created"].map((label) => (
              <div key={label}><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><Skeleton className="mt-1 h-5 w-36" /></div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
          <p className="text-sm text-muted-foreground">Replies here are visible to the church on their dashboard. Email alerts are attempted separately, and any unconfirmed result appears here for review.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border bg-muted/40 px-4 py-3"><Skeleton className="h-4 w-32" /><SkeletonText lines={2} className="mt-3" /></div>
          <div className="space-y-3"><p className="text-sm font-medium">Reply to the church</p><Skeleton className="h-32 w-full" /><Button disabled>Post reply and send email alert</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Admin update</CardTitle><p className="text-sm text-muted-foreground">Status and internal notes. Notes are for us only — the church never sees them. Post a reply above to say something they can read.</p></CardHeader>
        <CardContent className="space-y-4"><div><p className="text-sm font-medium">Status</p><Skeleton className="mt-2 h-11 w-full" /></div><div><p className="text-sm font-medium">Internal notes (private)</p><Skeleton className="mt-2 h-48 w-full" /></div><Button disabled>Save ticket</Button></CardContent>
      </Card>
    </SkeletonContainer>
  );
}
