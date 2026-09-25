import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { AccountNotice } from "@/components/settings/connected-accounts-messages";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export type AccountState = {
  connected: boolean;
  needsReconnect?: boolean;
};

export function AccountStatusBadge({ state }: { state: AccountState }) {
  if (state.connected) return <StatusBadge tone="done">Connected</StatusBadge>;
  if (state.needsReconnect) return <StatusBadge tone="attention">Needs reconnecting</StatusBadge>;
  return <StatusBadge tone="neutral">Not connected</StatusBadge>;
}

/** A success or problem message, shown beside the account it is about. */
export function AccountNoticeMessage({ notice }: { notice: Pick<AccountNotice, "kind" | "message"> }) {
  const success = notice.kind === "success";
  return (
    <p
      role={success ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-4 py-3 text-[15px] leading-relaxed",
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
          : "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      {success ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      )}
      <span>{notice.message}</span>
    </p>
  );
}

/**
 * One connected account: what it is, what it does for the church, whether it
 * is connected, and one obvious button.
 */
export function AccountRow({
  icon,
  name,
  purpose,
  state,
  detail,
  actions,
  notice,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  /** What this connection does, in one plain sentence. */
  purpose: string;
  state: AccountState;
  /** Which account, once connected. */
  detail?: string | null;
  actions: React.ReactNode;
  notice?: Pick<AccountNotice, "kind" | "message"> | null;
  /** Anything that opens under the row (e.g. a connect form). */
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-4 px-4 py-5 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-foreground">{name}</p>
              <AccountStatusBadge state={state} />
            </div>
            <p className="text-[15px] leading-snug text-muted-foreground">{purpose}</p>
            {detail && <p className="text-sm text-foreground/80">{detail}</p>}
            {!state.connected && state.needsReconnect && (
              <p className="flex items-start gap-1.5 text-sm text-orange-800 dark:text-orange-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>
                  FaithForm can&apos;t reach this account any more. Choose Reconnect and sign in
                  again. Your choices are kept.
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div>
      </div>
      {notice && <AccountNoticeMessage notice={notice} />}
      {children}
    </li>
  );
}
