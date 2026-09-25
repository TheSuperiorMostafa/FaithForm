"use client";

import { CheckCircle2, Circle, Landmark, RotateCcw } from "lucide-react";

import { useBankConnection } from "@/components/giving/use-bank-connection";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { connectionStatus, requirementTasks } from "@/lib/giving/labels";
import type { StripeOnboardingStatus } from "@/types/giving";

export type BankConnectionState = {
  hasAccount: boolean;
  status: StripeOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
};

/**
 * Where the church's bank connection stands, what's left to do in plain
 * words, and the one button that moves it forward. Used by the setup step and
 * by Giving settings.
 */
export function BankConnection({
  state,
  returnTo,
  onConnected,
}: {
  state: BankConnectionState;
  returnTo?: "settings";
  onConnected?: () => void;
}) {
  const { pending, connect, checkAgain } = useBankConnection();
  const status = connectionStatus(state.status, state.chargesEnabled);
  const tasks = requirementTasks(state.requirementsDue);
  const disconnected = state.status === "deauthorized";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Landmark className="size-6 text-primary dark:text-accent" aria-hidden />
        <span className="text-base font-semibold text-foreground">Bank connection</span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      {state.chargesEnabled ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {state.payoutsEnabled
            ? "Deposits are on. Gifts are sent to your church's bank account automatically."
            : "Your church can receive gifts. Deposits to your bank start once the last details are checked."}
        </p>
      ) : disconnected ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Your bank connection was removed, so gifts can&apos;t be received. Connect your bank again
          to start receiving gifts.
        </p>
      ) : state.hasAccount ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {tasks.length > 0
            ? "You're nearly there. Finish these and your church can receive gifts:"
            : "Your details are being checked. This usually takes a few minutes, and sometimes a day or two."}
        </p>
      ) : null}

      {tasks.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="What's left to do">
          {tasks.map((task) => (
            <li
              key={task}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-base text-foreground"
            >
              <Circle className="size-5 shrink-0 text-amber-500" aria-hidden />
              {task}
            </li>
          ))}
        </ul>
      )}

      {state.chargesEnabled && tasks.length === 0 && (
        <p className="flex items-center gap-2 text-[15px] font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-5" aria-hidden />
          Nothing left to do.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {!state.hasAccount || disconnected ? (
          <Button size="lg" disabled={pending} onClick={() => connect("onboard", returnTo)}>
            <Landmark aria-hidden />
            Connect your bank
          </Button>
        ) : state.status !== "active" ? (
          <>
            <Button size="lg" disabled={pending} onClick={() => connect("refresh", returnTo)}>
              <Landmark aria-hidden />
              {state.chargesEnabled ? "Finish your bank details" : "Finish connecting your bank"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => checkAgain(onConnected)}>
              <RotateCcw aria-hidden />
              Check again
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled={pending} onClick={() => checkAgain(onConnected)}>
            <RotateCcw aria-hidden />
            Check again
          </Button>
        )}
      </div>
    </div>
  );
}
