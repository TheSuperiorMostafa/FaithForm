import { Badge } from "@/components/ui/badge";
import type {
  SupportTicketPriority,
  SupportTicketStatus,
} from "@/lib/queries/admin";
import { cn } from "@/lib/utils";

export function ConnectedBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "success" : "muted"}>
      {connected ? "Connected" : "Not connected"}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={role === "admin" ? "default" : "muted"} className="capitalize">
      {role}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  const className =
    priority === "urgent"
      ? "border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
      : priority === "high"
        ? "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        : priority === "normal"
          ? "border-transparent bg-primary/10 text-primary dark:bg-accent/15 dark:text-accent"
          : "";

  return (
    <Badge
      variant={priority === "low" ? "muted" : "outline"}
      className={cn("capitalize", className)}
    >
      {priority.replace("_", " ")}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: SupportTicketStatus }) {
  const variant =
    status === "resolved"
      ? "success"
      : status === "in_progress"
        ? "warning"
        : "default";

  return (
    <Badge variant={variant} className="capitalize">
      {status.replace("_", " ")}
    </Badge>
  );
}
