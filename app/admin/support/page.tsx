import { PageHeader } from "@/components/admin/page-header";
import { SupportTicketDialog } from "@/components/admin/support-ticket-dialog";
import { SupportTicketsTable } from "@/components/admin/support-tickets-table";
import {
  getAdminChurchOptions,
  getAdminSupportTickets,
} from "@/lib/queries/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminSupportPage() {
  const [tickets, churches] = await Promise.all([
    getAdminSupportTickets(),
    getAdminChurchOptions(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Support"
        description="Track platform support tickets across all churches."
        action={<SupportTicketDialog churches={churches} />}
      />
      <SupportTicketsTable tickets={tickets} />
    </div>
  );
}
