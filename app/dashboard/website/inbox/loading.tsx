import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

/** Mirrors Website → Inbox: header, New / Read / Archived, message cards. */
export default function WebsiteInboxLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="website inbox">
      <SectionHeader
        title="Inbox"
        description="Messages visitors send through the contact form on your website. Each one is also emailed to your church."
      />

      <div className="flex w-full max-w-xl gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm">
        {["New", "Read", "Archived"].map((label, i) => (
          <span
            key={label}
            className={
              i === 0
                ? "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground"
                : "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold text-foreground/75"
            }
          >
            {label}
            <Skeleton className="h-5 w-6 rounded-full" />
          </span>
        ))}
      </div>

      <ul className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-11 w-24 rounded-[10px]" />
                <Skeleton className="h-11 w-36 rounded-[10px]" />
                <Skeleton className="h-11 w-28 rounded-[10px]" />
              </div>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <SkeletonText lines={2} size="base" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonContainer>
  );
}
