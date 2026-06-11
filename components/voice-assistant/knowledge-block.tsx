"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoiceAssistantContext } from "@/types/voice-assistant";

type KnowledgeBlockProps = {
  context: VoiceAssistantContext;
};

function KnowledgeRow({
  label,
  items,
  emptyMessage,
}: {
  label: string;
  items: string[];
  emptyMessage: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">{label}</p>
      {items.length > 0 ? (
        <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      )}
    </div>
  );
}

export function KnowledgeBlock({ context }: KnowledgeBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What your assistant already knows</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <KnowledgeRow
          label="Service schedule"
          items={context.serviceSchedule}
          emptyMessage="No service times added yet."
        />
        <KnowledgeRow
          label="Upcoming events"
          items={context.upcomingEvents}
          emptyMessage="No upcoming events."
        />
        <KnowledgeRow
          label="Pastoral staff"
          items={context.pastoralStaff}
          emptyMessage="No staff contacts listed yet."
        />
        <KnowledgeRow
          label="Programs"
          items={context.programs}
          emptyMessage="No programs listed yet."
        />
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          This information is managed in other sections of your dashboard and is
          automatically shared with your assistant. Update your{" "}
          <Link href="/dashboard/announcements" className="font-medium text-accent underline">
            announcements
          </Link>{" "}
          and{" "}
          <Link href="/dashboard/settings" className="font-medium text-accent underline">
            church profile
          </Link>{" "}
          to keep this current.
        </p>
      </CardContent>
    </Card>
  );
}
