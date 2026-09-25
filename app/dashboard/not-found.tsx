import Link from "next/link";
import { SearchX } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function DashboardNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="We couldn't find that page"
      description="It may have been moved or removed. Nothing you saved was lost."
      action={
        <Link href="/dashboard" className={buttonVariants()}>
          Go to Home
        </Link>
      }
    />
  );
}
