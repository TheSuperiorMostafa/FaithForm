import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function InvitationLoading() {
  return (
    <SkeletonContainer label="Church invitation" className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">You’re invited to your church</h1>
        <p className="text-muted-foreground">Open FaithForm to review your invitation and join. If you’re new, sign in or create an account first.</p>
        <button disabled className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground">Open FaithForm</button>
        <Skeleton className="mx-auto aspect-square w-64 max-w-full rounded-lg" />
        <p className="text-sm text-muted-foreground">On another device, scan this code from FaithForm’s invitation screen.</p>
      </div>
    </SkeletonContainer>
  );
}
