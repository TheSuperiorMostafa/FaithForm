import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BookOpen, Mail, MessageSquareText } from "lucide-react";

import {
  HELP_PAGE_DESCRIPTION,
  HELP_PAGE_TITLE,
  SUPPORT_RESPONSE_TIME,
  sanitizeFromPath,
} from "@/app/dashboard/support/ticket-helpers";
import { helpAnswersFor } from "@/app/dashboard/support/help-content";
import { SupportTicketForm } from "@/components/support/support-ticket-form";
import { SupportTicketsList } from "@/components/support/support-tickets-list";
import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { SUPPORT_EMAIL } from "@/lib/legal/policy-versions";
import { getChurchSupportTickets } from "@/lib/queries/support";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string | string[] }>;
};

export default async function SupportPage({ searchParams }: PageProps) {
  const [query, auth, access] = await Promise.all([
    searchParams,
    getChurchAuth(),
    getFeatureAccess(),
  ]);
  if (!auth) redirect("/login");

  const rawFrom = Array.isArray(query.from) ? query.from[0] : query.from;
  const fromPath = sanitizeFromPath(rawFrom);
  const answers = helpAnswersFor(access?.allowed ?? []);

  let tickets: Awaited<ReturnType<typeof getChurchSupportTickets>> | null = null;
  try {
    tickets = await getChurchSupportTickets(auth.churchId);
  } catch (error) {
    console.error("[help] tickets failed to load:", error);
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={HELP_PAGE_TITLE} description={HELP_PAGE_DESCRIPTION} />

      <ActionGrid>
        <ActionCard
          href="#message"
          icon={MessageSquareText}
          title="Send us a message"
          description="Write to us here and follow our reply on this page."
          tone="primary"
        />
        <ActionCard
          href={`mailto:${SUPPORT_EMAIL}`}
          icon={Mail}
          title="Email us"
          description={SUPPORT_EMAIL}
        />
        {answers.length > 0 && (
          <ActionCard
            href="#answers"
            icon={BookOpen}
            title="Common questions"
            description="Quick answers to the things churches ask most."
          />
        )}
      </ActionGrid>

      {answers.length > 0 && (
        <section id="answers" aria-labelledby="answers-heading" className="flex scroll-mt-24 flex-col gap-4">
          <SectionHeader id="answers-heading" title="Common questions" />
          <div className="grid gap-4 md:grid-cols-2">
            {answers.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <h3 className="font-heading text-lg font-bold text-foreground">{item.question}</h3>
                  <p className="flex-1 text-[15px] leading-relaxed text-muted-foreground">{item.answer}</p>
                  <Link href={item.href} className={buttonVariants({ variant: "outline", className: "self-start" })}>
                    {item.linkLabel}
                    <ArrowRight aria-hidden />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section id="message" aria-labelledby="message-heading" className="flex scroll-mt-24 flex-col gap-4">
        <SectionHeader
          id="message-heading"
          title="Send us a message"
          description={`Tell us what you need. We reply by email ${SUPPORT_RESPONSE_TIME}.`}
        />
        <Card>
          <CardContent className="p-6">
            <SupportTicketForm fromPath={fromPath} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="tickets-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="tickets-heading"
          title="Your messages"
          description="Everything your church has sent us, and our replies."
        />
        {tickets ? (
          <SupportTicketsList tickets={tickets} />
        ) : (
          <ErrorState
            compact
            title="Your messages didn't load"
            description="Nothing was lost. Refresh the page to try again."
          />
        )}
      </section>
    </div>
  );
}
