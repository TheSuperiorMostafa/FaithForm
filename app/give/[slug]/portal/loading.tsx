import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { PORTAL_SECTIONS } from "./portal-sections";

export default function PortalLoading() {
  return (
    <SkeletonContainer label="Donor portal" className="mx-auto max-w-lg space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Donor portal</h1>
          <Skeleton className="mt-1 h-4 w-32" />
        </div>
        <Button type="button" variant="ghost" size="sm" disabled>Sign out</Button>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Active payments</h2>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <SkeletonText lines={2} size="sm" className="max-w-56" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-32" />
            <Skeleton className="h-11 w-20" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        {PORTAL_SECTIONS.map(({ id, label }) => (
          <Button
            key={id}
            type="button"
            variant={id === "give-now" ? "default" : "outline"}
            className="min-w-0 whitespace-normal px-2"
            disabled
          >
            {label}
          </Button>
        ))}
      </div>
    </SkeletonContainer>
  );
}
