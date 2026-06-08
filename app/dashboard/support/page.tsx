import { redirect } from "next/navigation";
import { SupportTicketForm } from "@/components/support/support-ticket-form";
import { SupportTicketsList } from "@/components/support/support-tickets-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchSupportTickets } from "@/lib/queries/support";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const tickets = await getChurchSupportTickets(auth.churchId);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Support
        </h1>
        <p className="text-sm text-muted-foreground">
          Submit a ticket and track responses from the FaithForm team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New ticket</CardTitle>
          <CardDescription>
            Tell us what you need help with. We typically respond within one business day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SupportTicketForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your tickets</CardTitle>
          <CardDescription>Tickets submitted by your church.</CardDescription>
        </CardHeader>
        <CardContent>
          <SupportTicketsList tickets={tickets} />
        </CardContent>
      </Card>
    </div>
  );
}
