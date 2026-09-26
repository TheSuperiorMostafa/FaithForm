import { BookOpen, ChevronRight, Mail, MessageSquareText } from "lucide-react";

import {
  HELP_PAGE_DESCRIPTION,
  HELP_PAGE_TITLE,
  SUPPORT_RESPONSE_TIME,
} from "@/app/dashboard/support/ticket-helpers";
import { Card, CardContent } from "@/components/ui/card";
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
      icon: MessageSquareText,
      title: "Send us a message",
      description: "Write to us here and follow our reply on this page.",
      primary: true,
    },
    { icon: Mail, title: "Email us", description: SUPPORT_EMAIL, primary: false },
    {
      icon: BookOpen,
      title: "Common questions",
      description: "Quick answers to the things churches ask most.",
      primary: false,
    },
  ];

  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="help">
      <PageHeader title={HELP_PAGE_TITLE} description={HELP_PAGE_DESCRIPTION} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ icon: Icon, title, description, primary }) => (
          <div
            key={title}
            className={
              primary
                ? "flex min-h-[112px] items-center gap-4 rounded-2xl border border-transparent bg-primary p-5 text-primary-foreground shadow-sm dark:bg-card dark:text-foreground dark:ring-1 dark:ring-accent/40"
                : "flex min-h-[112px] items-center gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm"
            }
          >
            <span
              aria-hidden
              className={
                primary
                  ? "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/12 text-accent dark:bg-accent/15"
                  : "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
              }
            >
              <Icon className="size-7" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block font-heading text-lg font-bold leading-snug">{title}</span>
              <span
                className={
                  primary
                    ? "block text-[15px] leading-snug text-primary-foreground/80 dark:text-muted-foreground"
                    : "block text-[15px] leading-snug text-muted-foreground"
                }
              >
                {description}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 opacity-70" />
          </div>
        ))}
      </div>

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
