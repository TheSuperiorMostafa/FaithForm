import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { TEAM_MEMBER_STATUS_LABELS, type TeamMemberStatus } from "@/lib/service-plans/types";

const TONES: Record<TeamMemberStatus, StatusTone> = {
  confirmed: "done",
  declined: "attention",
  unconfirmed: "neutral",
};

/** Confirmed, Declined or Not confirmed yet: someone's answer to a shared plan. */
export function AnswerBadge({ status }: { status: TeamMemberStatus }) {
  return <StatusBadge tone={TONES[status]}>{TEAM_MEMBER_STATUS_LABELS[status]}</StatusBadge>;
}
