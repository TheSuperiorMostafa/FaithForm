import Link from "next/link";
import { History } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export function LogLink() {
  return (
    <Link
      href="/dashboard/attendance/follow-up/log"
      className={buttonVariants({ variant: "outline" })}
    >
      <History aria-hidden />
      Message log
    </Link>
  );
}
