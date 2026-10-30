import { BookOpen, Mail, MessageSquareText, Phone } from "lucide-react";

import {
  HELP_PAGE_DESCRIPTION,
  HELP_PAGE_TITLE,
  SUPPORT_RESPONSE_TIME,
  SUPPORT_TICKET_BODY_MAX,
} from "@/app/dashboard/support/ticket-helpers";
import { Card, CardContent } from "@/components/ui/card";
import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { SUPPORT_EMAIL } from "@/lib/legal/policy-versions";

/**
 * Mirrors the Help page: header, the contact cards and every heading render
 * as real text; only the answers that depend on your church's tools and your
 * own messages shimmer.
 */
export default function SupportLoading() {
  const cards = [
    {
      icon: Phone,
      href: "tel:+15026508301",
      title: "Call us",
      description: "(502) 650-8301",
      primary: true,
    },
    {
      icon: MessageSquareText,
      href: "sms:+15026508301",
      title: "Text us",
      description: "(502) 650-8301",
      primary: true,
    },
    { icon: Mail, href: `mailto:${SUPPORT_EMAIL}`, title: "Email us", description: SUPPORT_EMAIL, primary: false },
    {
      icon: BookOpen,
      href: "#answers",
      title: "Common questions",
      description: "Quick answers to the things churches ask most.",
      primary: false,
    },
  ];

  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="help">
      <PageHeader title={HELP_PAGE_TITLE} description={HELP_PAGE_DESCRIPTION} />

      <ActionGrid>
        {cards.map(({ icon, href, title, description, primary }) => (
          <ActionCard
            key={title}
            href={href}
            icon={icon}
            title={title}
            description={description}
            tone={primary ? "primary" : "default"}
          />
        ))}
      </ActionGrid>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Send us a message"
          description={`Tell us what you need. We reply by email ${SUPPORT_RESPONSE_TIME}.`}
        />
        <Card>
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-2">
              <p className="text-base font-semibold leading-none">Message</p>
              <Skeleton className="h-[195px] w-full rounded-[10px]" />
              <p className="text-xs text-muted-foreground">
                Up to {SUPPORT_TICKET_BODY_MAX.toLocaleString()} characters.
              </p>
            </div>
            <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
              <span className="space-y-0.5">
                <span className="block text-[15px] font-semibold">Add a subject line</span>
                <span className="block text-sm text-muted-foreground">
                  Optional. If you skip it, we use the first line of your message.
                </span>
              </span>
            </div>
            <div>
              <span className="inline-flex min-h-12 items-center rounded-[10px] bg-accent px-7 text-base font-semibold text-accent-foreground">
                Send message
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Your messages"
          description="Everything your church has sent us, and our replies."
        />
        <ul className="divide-y divide-border rounded-3xl border border-border bg-card shadow-sm">
          {Array.from({ length: 2 }).map((_, index) => (
            <li key={index} className="flex min-h-[72px] items-center gap-4 px-5 py-4">
              <span className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-64 max-w-full" />
                <Skeleton className="h-4 w-40" />
              </span>
              <Skeleton className="h-8 w-28 rounded-full" />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Common questions" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="flex h-full flex-col gap-3 p-6">
                <Skeleton className="h-6 w-56 max-w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-11 w-40 rounded-[10px]" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </SkeletonContainer>
  );
}
