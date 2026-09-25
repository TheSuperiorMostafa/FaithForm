"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, Plus } from "lucide-react";
import { toast } from "sonner";

import { showFundsInApp } from "@/app/dashboard/giving/faithform-actions";
import { createGivingFund, updateStatementSettings } from "@/app/dashboard/settings/giving-actions";
import { BankConnection, type BankConnectionState } from "@/components/giving/bank-connection";
import { GivingLinkCard } from "@/components/giving/giving-link-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessState } from "@/components/ui/success-state";
import { SETUP_STEP_LABELS, SETUP_STEPS, type SetupStep, setupStepIndex } from "@/lib/giving/setup";
import { cn } from "@/lib/utils";

export type SetupFund = {
  fundId: string;
  name: string;
  isDefault: boolean;
  inApp: boolean;
};

export type GivingSetupProps = {
  step: SetupStep;
  churchName: string;
  ein: string | null;
  statementAddress: string;
  connection: BankConnectionState;
  /** Only for the funds step. */
  funds: SetupFund[];
  /** Why funds can't be shown in the app yet, when that is the case. */
  appBlockedReason: string | null;
  givePageUrl: string;
  feeSummary: string;
};

/**
 * "Start accepting gifts": four steps on the Giving page, one screen each.
 * Nothing here moves money; the bank step hands over to the payment
 * partner's own secure pages and comes back.
 */
export function GivingSetup(props: GivingSetupProps) {
  const router = useRouter();
  const go = (step: SetupStep) => router.push(`/dashboard/giving?step=${step}`);

  return (
    <div className="flex flex-col gap-6">
      <SetupSteps current={props.step} />
      {props.step === "details" && <DetailsStep {...props} onDone={() => go("connect")} />}
      {props.step === "connect" && (
        <ConnectStep {...props} onBack={() => go("details")} onConnected={() => go("funds")} />
      )}
      {props.step === "funds" && <FundsStep {...props} onDone={() => go("ready")} />}
      {props.step === "ready" && <ReadyStep givePageUrl={props.givePageUrl} />}
    </div>
  );
}

export function SetupSteps({ current }: { current: SetupStep }) {
  const index = setupStepIndex(current);
  return (
    <ol aria-label="Steps to start accepting gifts" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {SETUP_STEPS.map((step, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 text-[15px] font-semibold",
              active
                ? "border-accent bg-accent/10 text-foreground"
                : done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                  : "border-border bg-card text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                active
                  ? "bg-accent text-accent-foreground"
                  : done
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span>
              <span className="sr-only">{done ? "Done: " : active ? "Now: " : "Next: "}</span>
              {SETUP_STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8">
      <div className="space-y-2">
        <h2 className="font-heading text-2xl font-bold text-foreground">{title}</h2>
        {description && (
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </Card>
  );
}

function DetailsStep({
  churchName,
  ein,
  statementAddress,
  onDone,
}: GivingSetupProps & { onDone: () => void }) {
  const [einValue, setEinValue] = useState(ein ?? "");
  const [address, setAddress] = useState(statementAddress);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const einId = useId();
  const addressId = useId();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateStatementSettings({
          ein: einValue.trim() || null,
          statementAddress: address.trim() || null,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(`Saved ${churchName}'s tax ID and address.`);
        onDone();
      } catch {
        setError("We couldn't save these details. Please try again.");
      }
    });
  };

  return (
    <StepCard
      title="Start accepting gifts"
      description="First, the details that go on your donors' year-end statements. You can change them later."
    >
      <form onSubmit={save} className="flex max-w-xl flex-col gap-5">
        <div className="space-y-1.5">
          <p className="text-[15px] font-semibold text-foreground">Church name</p>
          <p className="text-lg text-foreground">{churchName}</p>
          <p className="text-sm text-muted-foreground">
            Not your church&apos;s legal name?{" "}
            <Link href="/dashboard/settings?tab=church" className="font-semibold text-primary underline dark:text-accent">
              Change it in Settings
            </Link>
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={einId}>Tax ID (EIN)</Label>
          <Input
            id={einId}
            value={einValue}
            inputMode="numeric"
            autoComplete="off"
            placeholder="12-3456789"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${einId}-hint`}
            onChange={(e) => setEinValue(e.target.value)}
          />
          <p id={`${einId}-hint`} className="text-sm text-muted-foreground">
            The 9-digit number from your church&apos;s IRS letter. Printed on year-end statements.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={addressId}>Address for statements</Label>
          <Input
            id={addressId}
            value={address}
            autoComplete="street-address"
            placeholder="123 Main St, Springfield, IL 62701"
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-[15px] font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={pending}>
            Save and continue
            <ArrowRight aria-hidden />
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={onDone}>
            Skip for now
          </Button>
        </div>
      </form>
    </StepCard>
  );
}

function ConnectStep({
  connection,
  feeSummary,
  onBack,
  onConnected,
}: GivingSetupProps & { onBack: () => void; onConnected: () => void }) {
  return (
    <StepCard
      title="Connect your bank"
      description="Gifts go straight to your church's bank account. Our secure payment partner, Stripe, handles cards and bank details, so FaithForm never sees them. You'll leave this page for a few minutes, then come right back here."
    >
      <BankConnection state={connection} onConnected={onConnected} />
      <p className="max-w-2xl rounded-xl bg-muted/50 px-4 py-3 text-[15px] leading-relaxed text-muted-foreground">
        {feeSummary}
      </p>
      <div>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Back to church details
        </Button>
      </div>
    </StepCard>
  );
}

function FundsStep({
  funds,
  appBlockedReason,
  onDone,
}: GivingSetupProps & { onDone: () => void }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(funds.filter((f) => f.isDefault || f.inApp).map((f) => f.fundId)),
  );
  const [newFund, setNewFund] = useState("");
  const [pending, startTransition] = useTransition();
  const newFundId = useId();

  const toggle = (fundId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(fundId)) next.delete(fundId);
      else next.add(fundId);
      return next;
    });

  const addFund = () => {
    const name = newFund.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const result = await createGivingFund(name);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`${name} added to your funds.`);
        setNewFund("");
        router.refresh();
      } catch {
        toast.error("We couldn't add that fund. Please try again.");
      }
    });
  };

  const save = () => {
    const toShow = funds.filter((f) => checked.has(f.fundId) && !f.inApp).map((f) => f.fundId);
    if (toShow.length === 0 || appBlockedReason) {
      onDone();
      return;
    }
    startTransition(async () => {
      try {
        const result = await showFundsInApp(toShow);
        if (!result.ok) {
          toast.error(result.error ?? "We couldn't show those funds in the app. Please try again.");
          return;
        }
        const names = funds.filter((f) => toShow.includes(f.fundId)).map((f) => f.name);
        toast.success(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} now in the FaithForm app.`);
        onDone();
      } catch {
        toast.error("We couldn't show those funds in the app. Please try again.");
      }
    });
  };

  return (
    <StepCard
      title="Choose where people can give"
      description="All your funds are on your giving page. Tick the ones to show in the FaithForm app too. They'll be open to everyone, with $25, $50 and $100 buttons you can change later."
    >
      {appBlockedReason && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {appBlockedReason}
        </p>
      )}
      <fieldset className="flex max-w-xl flex-col gap-3">
        <legend className="sr-only">Funds to show in the app</legend>
        {funds.map((fund) => (
          <label
            key={fund.fundId}
            className="flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold text-foreground has-[:checked]:border-accent has-[:checked]:bg-accent/10"
          >
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={checked.has(fund.fundId) || fund.inApp}
              disabled={fund.inApp || Boolean(appBlockedReason) || pending}
              onChange={() => toggle(fund.fundId)}
            />
            <span className="flex-1">{fund.name}</span>
            {fund.inApp ? (
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Already in the app</span>
            ) : fund.isDefault ? (
              <span className="text-sm font-medium text-muted-foreground">Main fund</span>
            ) : null}
          </label>
        ))}
      </fieldset>

      <div className="flex max-w-xl flex-col gap-2">
        <Label htmlFor={newFundId}>Add another fund</Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id={newFundId}
            value={newFund}
            placeholder="Youth ministry"
            onChange={(e) => setNewFund(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFund();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={pending || !newFund.trim()} onClick={addFund}>
            <Plus aria-hidden />
            Add fund
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={pending} onClick={save}>
          Save and continue
          <ArrowRight aria-hidden />
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onDone}>
          Skip for now
        </Button>
      </div>
    </StepCard>
  );
}

function ReadyStep({ givePageUrl }: { givePageUrl: string }) {
  return (
    <div className="flex flex-col gap-6">
      <SuccessState
        title="You're ready to receive gifts"
        description="Share your giving link so people can start giving. Gifts show up on the Giving page as they come in."
        actions={
          <Link href="/dashboard/giving" className={buttonVariants({ size: "lg" })}>
            Go to Giving
            <ArrowRight aria-hidden />
          </Link>
        }
      />
      <GivingLinkCard givePageUrl={givePageUrl} title="Share your giving link" />
    </div>
  );
}
