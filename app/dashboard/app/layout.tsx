import { Smartphone } from "lucide-react";

import { ChurchAppTabs } from "@/components/member-app/church-app-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default function ChurchAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Church App"
        icon={Smartphone}
        description="Your church's page in the FaithForm app."
      />

      <ChurchAppTabs />

      {children}
    </div>
  );
}
