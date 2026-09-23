import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function MemberAppLoading() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-7xl flex-col gap-8"
      label="member app settings"
    >
      <div>
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="mt-1 h-4 w-96 max-w-full" />
      </div>

      {/* Church Page Editor Section */}
      <section className="flex flex-col gap-4">
        <div className="space-y-1">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            </div>
          </Card>

          <aside className="self-start">
            <Card className="mx-auto flex h-[520px] w-full max-w-[340px] flex-col items-center justify-between rounded-[40px] border-4 border-border p-5 shadow-card dark:shadow-none">
              <div className="flex w-full items-center justify-between px-2">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="h-3 w-8" />
              </div>
              <div className="space-y-3 text-center w-full px-4">
                <Skeleton className="size-20 rounded-full mx-auto" />
                <Skeleton className="h-5 w-36 mx-auto" />
                <Skeleton className="h-3.5 w-48 mx-auto" />
              </div>
              <Skeleton className="h-10 w-full rounded-xl" />
            </Card>
          </aside>
        </div>
      </section>

      {/* How People Add Your Church Section */}
      <section className="flex flex-col gap-4">
        <div className="space-y-1">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card key={1} className="p-6 space-y-4 shadow-card dark:shadow-none">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full rounded-md" />
          </Card>
          <Card key={2} className="p-6 space-y-4 shadow-card dark:shadow-none">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full rounded-md" />
          </Card>
        </div>
      </section>
    </SkeletonContainer>
  );
}
