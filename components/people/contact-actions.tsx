import { Mail, MessageSquare, Phone } from "lucide-react";

import { contactLinks, hasAnyContact } from "@/components/people/people-format";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Call, Text and Email, each with its icon and its word. A button appears
 * only when the detail behind it exists, and each one opens the phone's or
 * computer's own app: nothing is sent from FaithForm.
 */
export function ContactActions({
  firstName,
  phone,
  email,
  size = "default",
  className,
  emptyText,
}: {
  firstName: string;
  phone?: string | null;
  email?: string | null;
  size?: "default" | "lg";
  className?: string;
  /** Shown when there is no way to reach them. Nothing is shown if omitted. */
  emptyText?: string;
}) {
  const links = contactLinks({ phone, email });

  if (!hasAnyContact(links)) {
    return emptyText ? (
      <p className={cn("text-[15px] text-muted-foreground", className)}>{emptyText}</p>
    ) : null;
  }

  const button = cn(buttonVariants({ variant: "outline", size }), "gap-2");

  return (
    <div
      role="group"
      aria-label={`Contact ${firstName}`}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {links.call ? (
        <a href={links.call} className={button} aria-label={`Call ${firstName}`}>
          <Phone aria-hidden className="size-5" />
          Call
        </a>
      ) : null}
      {links.text ? (
        <a href={links.text} className={button} aria-label={`Text ${firstName}`}>
          <MessageSquare aria-hidden className="size-5" />
          Text
        </a>
      ) : null}
      {links.email ? (
        <a href={links.email} className={button} aria-label={`Email ${firstName}`}>
          <Mail aria-hidden className="size-5" />
          Email
        </a>
      ) : null}
    </div>
  );
}
