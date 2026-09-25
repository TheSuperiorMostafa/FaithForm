import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** The one "back" link every Sermons sub-page opens with. */
export function SermonBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-5" />
      {label}
    </Link>
  );
}

/** Same link, as plain text for a loading skeleton. */
export function SermonBackLinkStatic({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
      <ArrowLeft aria-hidden className="size-5" />
      {label}
    </span>
  );
}
