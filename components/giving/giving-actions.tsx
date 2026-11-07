import { FileText, Landmark, Plus, Receipt, Repeat, Settings, Users } from "lucide-react";
import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { AdvancedSection } from "@/components/ui/advanced-section";

/** Static actions render in both the page and its matching fallback. */
export function GivingActions({isAdmin}: {isAdmin: boolean}) {
  return <section aria-label="Giving actions" className="space-y-4">
    <ActionGrid>
      {isAdmin && <ActionCard href="/dashboard/giving/record" icon={Plus} title="Record donations" description="Add cash and check gifts, or import a spreadsheet." />}
      <ActionCard href="/dashboard/giving/gifts" icon={Receipt} title="All gifts" description="Search every gift and download a spreadsheet." />
      <ActionCard href="/dashboard/giving/donors" icon={Users} title="Donors" description="Who gave, and what they gave this year." />
      <ActionCard href="/dashboard/giving/recurring" icon={Repeat} title="Recurring gifts" description="Gifts that repeat on their own." />
    </ActionGrid>
    <AdvancedSection title="More" description="Deposits, year-end statements and settings">
      <ActionGrid>
        <ActionCard href="/dashboard/giving/payouts" icon={Landmark} title="Deposits" description="Money on its way to your church's bank." />
        <ActionCard href="/dashboard/giving/statements" icon={FileText} title="Year-end statements" description="Email or print each donor's yearly record." />
        {isAdmin && <ActionCard href="/dashboard/giving/settings" icon={Settings} title="Giving settings" description="Funds, statement details, giving page and the app." />}
      </ActionGrid>
    </AdvancedSection>
  </section>;
}
