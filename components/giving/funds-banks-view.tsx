"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowRight, ExternalLink, Landmark, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  changeFundBank,
  createFundWithBank,
  openFundAccountOnboarding,
  refreshFundAccount,
  renameFundAccount,
  setFundAccountBankLabel,
  type BankChoice,
} from "@/app/dashboard/giving/funds/actions";
import {
  accountStatusLabel,
  bankLine,
  formatPayoutDate,
  FUNDS_BANKS_COPY,
  FundsBanksNotes,
  payoutScheduleLine,
} from "@/components/giving/funds-banks-parts";
import { plural } from "@/components/giving/giving-page-parts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { depositStatus } from "@/lib/giving/labels";
import type { FundsBankAccount, FundsBankFund } from "@/lib/queries/fund-accounts";
import { undoToast } from "@/lib/ui/undo-toast";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/utils/currency";

/**
 * Funds & banks: which bank each fund's gifts go to. Every change goes through
 * the admin-only server actions in app/dashboard/giving/funds/actions.ts; bank
 * numbers are only ever entered in Stripe.
 */

const PAGE_PATH = "/dashboard/giving/funds";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The synthetic main-account row (`main:acct_…`) can't be renamed or labelled. */
function isStoredAccount(account: FundsBankAccount): boolean {
  return UUID.test(account.id);
}

/** Sends the admin to Stripe's onboarding for one fund account. */
async function goToStripe(accountRowId: string): Promise<string | null> {
  try {
    const result = await openFundAccountOnboarding(accountRowId);
    if (result.url) {
      window.location.assign(result.url);
      return null;
    }
    return result.error ?? "We couldn't open Stripe just now. Try again in a minute.";
  } catch {
    return "We couldn't open Stripe just now. Try again in a minute.";
  }
}

// ---------------------------------------------------------------------------
// Page body
// ---------------------------------------------------------------------------

export type StripeReturnParams = { accountRowId: string; mode: "return" | "refresh" } | null;

export function FundsBanksView({
  accounts,
  funds,
  stripeReturn,
}: {
  accounts: FundsBankAccount[];
  funds: FundsBankFund[];
  stripeReturn: StripeReturnParams;
}) {
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [changing, setChanging] = useState<FundsBankFund | null>(null);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const openAccount = openAccountId ? accountById.get(openAccountId) ?? null : null;

  return (
    <>
      {stripeReturn && <StripeReturnHandler params={stripeReturn} accounts={accounts} />}

      <section className="flex flex-col gap-4" aria-labelledby="funds-heading">
        <SectionHeader
          id="funds-heading"
          title={FUNDS_BANKS_COPY.fundsTitle}
          description={FUNDS_BANKS_COPY.fundsDescription}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {funds.map((fund) => (
            <FundCard
              key={fund.fundId}
              fund={fund}
              account={fund.accountRowId ? accountById.get(fund.accountRowId) ?? null : null}
              pendingAccount={fund.pendingAccountRowId ? accountById.get(fund.pendingAccountRowId) ?? null : null}
              onChangeBank={() => setChanging(fund)}
              onOpenAccount={(id) => setOpenAccountId(id)}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="accounts-heading">
        <SectionHeader
          id="accounts-heading"
          title={FUNDS_BANKS_COPY.accountsTitle}
          description={FUNDS_BANKS_COPY.accountsDescription}
        />
        <List label="Bank accounts">
          {accounts.map((account) => {
            const status = accountStatusLabel(account.displayStatus);
            const usedBy =
              account.fundNames.length > 0 ? `Used by ${account.fundNames.join(", ")}` : "No funds use it yet";
            return (
              <ListRow
                key={account.id}
                onClick={() => setOpenAccountId(account.id)}
                aria-label={`${account.label}: see deposits and details`}
                leading={
                  <span
                    aria-hidden
                    className="flex size-12 items-center justify-center rounded-full bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent"
                  >
                    <Landmark className="size-6" strokeWidth={1.75} />
                  </span>
                }
                title={account.isPrimary ? `${account.label} (main account)` : account.label}
                subtitle={`${bankLine(account)} · ${usedBy}`}
                status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
              />
            );
          })}
        </List>
      </section>

      <FundsBanksNotes />

      {openAccount && (
        <AccountDialog account={openAccount} onClose={() => setOpenAccountId(null)} />
      )}
      {changing && (
        <ChangeBankDialog
          fund={changing}
          accounts={accounts}
          onClose={() => setChanging(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One fund
// ---------------------------------------------------------------------------

function FundCard({
  fund,
  account,
  pendingAccount,
  onChangeBank,
  onOpenAccount,
}: {
  fund: FundsBankFund;
  account: FundsBankAccount | null;
  pendingAccount: FundsBankAccount | null;
  onChangeBank: () => void;
  onOpenAccount: (accountRowId: string) => void;
}) {
  const status = account ? accountStatusLabel(account.displayStatus) : { label: "Not set up", tone: "neutral" as const };
  const last = account?.lastPayout ?? null;
  const lastLine = last
    ? [
        formatCents(last.amountCents, last.currency),
        formatPayoutDate(last.arrivalDate) ?? "date not set yet",
        depositStatus(last.status).label,
      ].join(" · ")
    : "None yet";

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words font-heading text-lg font-bold leading-8 text-foreground">{fund.name}</h3>
          {fund.isDefault && <StatusBadge tone="done">Main fund</StatusBadge>}
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Fact term="Bank">{account ? `${account.label}: ${bankLine(account)}` : "No bank connected"}</Fact>
        <Fact term="Deposit schedule">{account ? payoutScheduleLine(account.payoutSchedule) : "Not known yet"}</Fact>
        <Fact term="Last deposit">{lastLine}</Fact>
        <Fact term="Gifts in the last 30 days">{formatCents(fund.last30DaysCents)}</Fact>
      </dl>

      {(pendingAccount || !fund.givable) && (
        <div className="flex flex-col gap-2 rounded-xl bg-muted/60 px-4 py-3 text-[15px] leading-relaxed text-foreground">
          {pendingAccount && <p>Switches to {pendingAccount.label} when Stripe finishes setup.</p>}
          {!fund.givable && (
            <p>Hidden from your giving page until its bank is ready to take gifts.</p>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant="outline" onClick={onChangeBank}>
          <Landmark aria-hidden />
          Change bank
        </Button>
        {account && (
          <Button variant="ghost" onClick={() => onOpenAccount(account.id)}>
            Bank details
            <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </Card>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-sm font-semibold text-muted-foreground">{term}</dt>
      <dd className="break-words text-[15px] leading-6 text-foreground">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choosing a bank
// ---------------------------------------------------------------------------

type ChoiceDraft = {
  kind: BankChoice["kind"];
  accountRowId: string;
  label: string;
  treasurerEmail: string;
};

/** Accounts a fund can be pointed at, besides the main one. */
function otherAccounts(accounts: FundsBankAccount[]) {
  return accounts.filter((a) => !a.isPrimary && a.displayStatus !== "disconnected" && isStoredAccount(a));
}

function draftToChoice(draft: ChoiceDraft): BankChoice | null {
  if (draft.kind === "main") return { kind: "main" };
  if (draft.kind === "existing") return draft.accountRowId ? { kind: "existing", accountRowId: draft.accountRowId } : null;
  const label = draft.label.trim();
  if (!label) return null;
  const email = draft.treasurerEmail.trim();
  return { kind: "new", label, ...(email ? { treasurerEmail: email } : {}) };
}

function BankChoiceFields({
  draft,
  onChange,
  accounts,
  disabled,
  isNewFund = false,
}: {
  draft: ChoiceDraft;
  onChange: (draft: ChoiceDraft) => void;
  accounts: FundsBankAccount[];
  disabled?: boolean;
  /** A new fund has no bank to keep while a new one is set up. */
  isNewFund?: boolean;
}) {
  const id = useId();
  const others = otherAccounts(accounts);
  const options: { kind: BankChoice["kind"]; title: string; description: string }[] = [
    {
      kind: "main",
      title: "Your main bank account",
      description: "The same bank as your church's other giving.",
    },
    ...(others.length > 0
      ? [
          {
            kind: "existing" as const,
            title: "Another bank account you've added",
            description: "A bank account you set up for another fund.",
          },
        ]
      : []),
    {
      kind: "new",
      title: "A new bank account for this fund",
      description: isNewFund
        ? "You'll set it up in Stripe next. The fund stays off your giving page until then."
        : "You'll set it up in Stripe next. Until then the fund keeps its current bank.",
    },
  ];

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-[15px] font-semibold text-foreground">Where should its gifts go?</legend>
      {options.map((option) => (
        <label
          key={option.kind}
          className={cn(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors",
            draft.kind === option.kind && "border-accent bg-accent/[0.06] ring-1 ring-accent/40",
          )}
        >
          <input
            type="radio"
            name={`${id}-bank`}
            value={option.kind}
            checked={draft.kind === option.kind}
            onChange={() =>
              onChange({
                ...draft,
                kind: option.kind,
                accountRowId: option.kind === "existing" && !draft.accountRowId ? others[0]?.id ?? "" : draft.accountRowId,
              })
            }
            className="mt-1 size-5 shrink-0 accent-primary"
          />
          <span className="space-y-0.5">
            <span className="block text-[15px] font-semibold text-foreground">{option.title}</span>
            <span className="block text-sm leading-relaxed text-muted-foreground">{option.description}</span>
          </span>
        </label>
      ))}

      {draft.kind === "existing" && others.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-existing`}>Bank account</Label>
          <Select
            id={`${id}-existing`}
            value={draft.accountRowId}
            onChange={(e) => onChange({ ...draft, accountRowId: e.target.value })}
          >
            {others.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} ({bankLine(account)}){account.displayStatus === "active" ? "" : ", setup not finished"}
              </option>
            ))}
          </Select>
        </div>
      )}

      {draft.kind === "new" && (
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-label`}>Name for this bank account</Label>
            <Input
              id={`${id}-label`}
              value={draft.label}
              maxLength={80}
              placeholder="Missions bank"
              onChange={(e) => onChange({ ...draft, label: e.target.value })}
            />
            <p className="text-sm text-muted-foreground">Only your team sees this name.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-email`}>Treasurer&apos;s email (optional)</Label>
            <Input
              id={`${id}-email`}
              type="email"
              value={draft.treasurerEmail}
              maxLength={254}
              autoComplete="off"
              placeholder="treasurer@yourchurch.org"
              onChange={(e) => onChange({ ...draft, treasurerEmail: e.target.value })}
            />
            <p className="text-sm text-muted-foreground">
              Stripe sends this bank account&apos;s sign-in and notices here. The bank details themselves are entered
              only in Stripe.
            </p>
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** What happens after a fund was pointed at a bank that isn't ready yet. */
type SetupStep = { message: string; accountRowId: string | null };

function SetupStepBody({
  step,
  onDone,
  pending,
  error,
  onSetUp,
  titleId,
  title,
}: {
  step: SetupStep;
  onDone: () => void;
  pending: boolean;
  error: string | null;
  onSetUp: () => void;
  titleId: string;
  title: string;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle id={titleId}>{title}</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-5">
        <p className="text-[15px] leading-relaxed text-foreground">{step.message}</p>
        {step.accountRowId && (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            The treasurer enters the bank details in Stripe. You&apos;ll come back here when it&apos;s done.
          </p>
        )}
        {error && (
          <p role="alert" className="text-[15px] font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>
          {step.accountRowId ? "Later" : "Done"}
        </Button>
        {step.accountRowId && (
          <Button type="button" disabled={pending} onClick={onSetUp}>
            {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ExternalLink aria-hidden />}
            Set up the bank in Stripe
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Add fund (the page's primary action)
// ---------------------------------------------------------------------------

export function AddFundButton({ accounts }: { accounts: FundsBankAccount[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Add fund
      </Button>
      {open && <AddFundDialog accounts={accounts} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddFundDialog({ accounts, onClose }: { accounts: FundsBankAccount[]; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<ChoiceDraft>({ kind: "main", accountRowId: "", label: "", treasurerEmail: "" });
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    if (step) router.refresh();
    onClose();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const fundName = name.trim();
    if (!fundName) {
      setError("Give the fund a name.");
      return;
    }
    const bank = draftToChoice(draft);
    if (!bank) {
      setError(draft.kind === "new" ? "Give the new bank account a name." : "Choose a bank account.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createFundWithBank({ name: fundName, bank });
        if (result.error) {
          if (result.fundId) {
            // The fund exists on the main account; say why the bank part failed.
            toast.error(result.error);
            router.refresh();
            onClose();
          } else {
            setError(result.error);
          }
          return;
        }
        const chosen = bank.kind === "existing" ? accounts.find((a) => a.id === bank.accountRowId) : null;
        if (bank.kind === "main" || chosen?.displayStatus === "active") {
          toast.success(
            `${fundName} added. Its gifts go to ${chosen ? chosen.label : "your main bank account"}, and donors can choose it now.`,
          );
          router.refresh();
          onClose();
          return;
        }
        const label = bank.kind === "new" ? bank.label : chosen?.label ?? "the new bank";
        setStep({
          message: `${fundName} is added. Next, set up ${label} in Stripe. ${fundName} stays off your giving page until Stripe finishes.`,
          accountRowId: result.accountRowId ?? null,
        });
      } catch {
        setError("We couldn't add that fund. Please try again.");
      }
    });
  };

  const setUp = () => {
    if (!step?.accountRowId) return;
    const accountRowId = step.accountRowId;
    setError(null);
    startTransition(async () => {
      const failed = await goToStripe(accountRowId);
      if (failed) setError(failed);
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? null : close())}>
      <DialogContent aria-labelledby={`${id}-title`} className="max-w-xl" onRequestClose={() => !pending}>
        {step ? (
          <div className="flex min-h-0 flex-auto flex-col">
            <SetupStepBody
              step={step}
              title="Fund added"
              titleId={`${id}-title`}
              pending={pending}
              error={error}
              onDone={close}
              onSetUp={setUp}
            />
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
            <DialogHeader>
              <DialogTitle id={`${id}-title`}>Add a fund</DialogTitle>
              <DialogDescription className="text-[15px]">
                Donors choose a fund on your giving page. Pick which bank its gifts go to.
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto px-6 py-5">
              <div className="space-y-2">
                <Label htmlFor={`${id}-name`}>Fund name</Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={80}
                  autoFocus
                  placeholder="Missions"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <BankChoiceFields draft={draft} onChange={setDraft} accounts={accounts} disabled={pending} isNewFund />
              {error && (
                <p role="alert" className="text-[15px] font-medium text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
                Add fund
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Change a fund's bank
// ---------------------------------------------------------------------------

function ChangeBankDialog({
  fund,
  accounts,
  onClose,
}: {
  fund: FundsBankFund;
  accounts: FundsBankAccount[];
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const current = fund.accountRowId ? accounts.find((a) => a.id === fund.accountRowId) ?? null : null;
  const currentIsMain = !current || current.isPrimary;
  // A disconnected current bank isn't offered again, so start from the main one.
  const currentOffered = !currentIsMain && otherAccounts(accounts).some((a) => a.id === current?.id);
  const initial: ChoiceDraft = {
    kind: currentOffered ? "existing" : "main",
    accountRowId: currentOffered ? current!.id : "",
    label: "",
    treasurerEmail: "",
  };
  const [draft, setDraft] = useState<ChoiceDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [pending, startTransition] = useTransition();

  const unchanged =
    (draft.kind === "main" && currentIsMain && !fund.pendingAccountRowId) ||
    (draft.kind === "existing" && !currentIsMain && draft.accountRowId === current?.id && !fund.pendingAccountRowId);
  const currentLabel = current?.label ?? "your main bank account";

  const close = () => {
    if (step) router.refresh();
    onClose();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const bank = draftToChoice(draft);
    if (!bank) {
      setError(draft.kind === "new" ? "Give the new bank account a name." : "Choose a bank account.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeFundBank(fund.fundId, bank);
        if (result.error) {
          setError(result.error);
          return;
        }
        const target =
          bank.kind === "main"
            ? "your main bank account"
            : bank.kind === "new"
              ? bank.label
              : accounts.find((a) => a.id === bank.accountRowId)?.label ?? "the new bank";

        if (result.switchesWhenReady) {
          setStep({
            message: `${fund.name} keeps using ${currentLabel} until ${target} is ready. Gifts keep coming in the whole time.`,
            accountRowId: result.accountRowId ?? null,
          });
          return;
        }

        router.refresh();
        onClose();
        // An immediate move can be put back exactly; a pending switch can't.
        if (!fund.pendingAccountRowId) {
          const previous: BankChoice = currentIsMain ? { kind: "main" } : { kind: "existing", accountRowId: current!.id };
          undoToast(
            `${fund.name}'s gifts now go to ${target}.`,
            async () => {
              const undone = await changeFundBank(fund.fundId, previous);
              router.refresh();
              return undone.error;
            },
            { undoneMessage: `${fund.name}'s gifts go to ${currentLabel} again.` },
          );
        } else {
          toast.success(`${fund.name}'s gifts now go to ${target}.`);
        }
      } catch {
        setError("We couldn't change where this fund's gifts go. Please try again.");
      }
    });
  };

  const setUp = () => {
    if (!step?.accountRowId) return;
    const accountRowId = step.accountRowId;
    setError(null);
    startTransition(async () => {
      const failed = await goToStripe(accountRowId);
      if (failed) setError(failed);
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? null : close())}>
      <DialogContent aria-labelledby={`${id}-title`} className="max-w-xl" onRequestClose={() => !pending}>
        {step ? (
          <div className="flex min-h-0 flex-auto flex-col">
            <SetupStepBody
              step={step}
              title="Bank change saved"
              titleId={`${id}-title`}
              pending={pending}
              error={error}
              onDone={close}
              onSetUp={setUp}
            />
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
            <DialogHeader>
              <DialogTitle id={`${id}-title`}>Change bank for {fund.name}</DialogTitle>
              <DialogDescription className="text-[15px]">
                Its gifts go to {currentLabel} now. Past gifts and deposits stay where they are.
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto px-6 py-5">
              <BankChoiceFields draft={draft} onChange={setDraft} accounts={accounts} disabled={pending} />
              <p className="text-sm leading-relaxed text-muted-foreground">
                Recurring gifts and cards donors saved for {currentLabel} stay with that bank. Donors enter their card
                again for gifts that go to a different bank.
              </p>
              {error && (
                <p role="alert" className="text-[15px] font-medium text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || unchanged}>
                {pending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
                Save bank
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// One bank account
// ---------------------------------------------------------------------------

function AccountDialog({ account, onClose }: { account: FundsBankAccount; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = accountStatusLabel(account.displayStatus);
  const stored = isStoredAccount(account);
  const needed = account.requirementsDue.length;

  const finishSetup = () => {
    setError(null);
    startTransition(async () => {
      const failed = await goToStripe(account.id);
      if (failed) setError(failed);
    });
  };

  const checkAgain = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await refreshFundAccount(account.id);
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(
          result.canTakeGifts
            ? `${account.label} is ready. Its funds can take gifts.`
            : `${account.label} is still being set up. We'll show here what Stripe needs.`,
        );
        router.refresh();
      } catch {
        setError("We couldn't check this bank account with Stripe. Try again in a minute.");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent aria-labelledby={`${id}-title`} className="max-w-2xl" onRequestClose={() => !pending}>
        <div className="flex min-h-0 flex-auto flex-col">
          <DialogHeader className="pr-16">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle id={`${id}-title`}>{account.label}</DialogTitle>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </div>
            <DialogDescription className="text-[15px]">
              {bankLine(account)} · {payoutScheduleLine(account.payoutSchedule)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-auto flex-col gap-6 overflow-y-auto px-6 py-5">
            <section className="space-y-3" aria-label="Setup">
              {account.isPrimary ? (
                <>
                  <p className="text-[15px] leading-relaxed text-foreground">
                    This is your church&apos;s main bank account. Connect or change it in Giving settings.
                  </p>
                  <Link href="/dashboard/giving/settings" className={buttonVariants({ variant: "outline" })}>
                    Open Giving settings
                    <ArrowRight aria-hidden />
                  </Link>
                </>
              ) : account.displayStatus === "disconnected" ? (
                <p className="text-[15px] leading-relaxed text-foreground">
                  This bank account is no longer connected. Its funds can&apos;t take gifts. Use Change bank on each
                  fund to send its gifts somewhere else.
                </p>
              ) : account.displayStatus === "active" ? (
                <p className="text-[15px] leading-relaxed text-foreground">
                  Ready. Gifts to its funds go straight to this bank. To change the bank itself, sign in to Stripe.
                </p>
              ) : (
                <>
                  <p className="text-[15px] leading-relaxed text-foreground">
                    {needed > 0
                      ? `Stripe needs ${plural(needed, "more detail")} before this bank can take gifts.`
                      : account.displayStatus === "needs_info"
                        ? "Stripe needs a few more details before this bank can take gifts."
                        : "Stripe is checking the details. This usually takes a day or two."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={pending} onClick={finishSetup}>
                      {pending ? (
                        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                      ) : (
                        <ExternalLink aria-hidden />
                      )}
                      Finish setup in Stripe
                    </Button>
                    <Button variant="outline" disabled={pending} onClick={checkAgain}>
                      <RefreshCw aria-hidden />
                      Check again
                    </Button>
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="text-[15px] font-medium text-destructive">
                  {error}
                </p>
              )}
            </section>

            <section className="space-y-2 border-t border-border pt-5">
              <h3 className="text-base font-semibold text-foreground">Funds using this bank</h3>
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                {account.fundNames.length > 0 ? account.fundNames.join(", ") : "No funds use it yet."}
              </p>
            </section>

            <section className="space-y-3 border-t border-border pt-5">
              <h3 className="text-base font-semibold text-foreground">Recent deposits</h3>
              {account.recentPayouts.length === 0 ? (
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  No deposits yet. The first one usually arrives a few days after the first gift.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-2xl border border-border">
                  {account.recentPayouts.map((payout) => {
                    const plain = depositStatus(payout.status);
                    return (
                      <li key={payout.stripePayoutId} className="flex min-h-14 items-center gap-3 px-4 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-foreground">
                            {formatCents(payout.amountCents, payout.currency)}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {formatPayoutDate(payout.arrivalDate) ?? "Date not set yet"}
                          </span>
                        </span>
                        <StatusBadge tone={plain.tone}>{plain.label}</StatusBadge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {stored && <RenameAccountForm account={account} />}
            {stored && !account.bankName && !account.bankLast4 && <BankLabelForm account={account} />}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenameAccountForm({ account }: { account: FundsBankAccount }) {
  const router = useRouter();
  const id = useId();
  const [label, setLabel] = useState(account.label);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const next = label.trim();
    if (!next || next === account.label) return;
    const previous = account.label;
    setError(null);
    startTransition(async () => {
      try {
        const result = await renameFundAccount(account.id, next);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
        undoToast(
          `${previous} is now called ${next}.`,
          async () => {
            const undone = await renameFundAccount(account.id, previous);
            router.refresh();
            return undone.error;
          },
          { undoneMessage: `${next} is called ${previous} again.` },
        );
      } catch {
        setError("We couldn't rename that account. Please try again.");
      }
    });
  };

  return (
    <form onSubmit={save} className="space-y-2 border-t border-border pt-5">
      <Label htmlFor={`${id}-label`} className="text-base">
        Name
      </Label>
      <p className="text-sm text-muted-foreground">Only your team sees this name. Stripe isn&apos;t changed.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id={`${id}-label`}
          value={label}
          maxLength={80}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending || !label.trim() || label.trim() === account.label}>
          <Pencil aria-hidden />
          Save name
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function BankLabelForm({ account }: { account: FundsBankAccount }) {
  const router = useRouter();
  const id = useId();
  const [bankName, setBankName] = useState("");
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!bankName.trim()) {
      setError("Enter the bank's name.");
      return;
    }
    if (!/^[0-9]{4}$/.test(last4.trim())) {
      setError("Enter only the last 4 digits of the account number.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await setFundAccountBankLabel(account.id, { bankName: bankName.trim(), last4: last4.trim() });
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(`${account.label} now shows as ${bankName.trim()} •••${last4.trim()}.`);
        router.refresh();
      } catch {
        setError("We couldn't save the bank name. Please try again.");
      }
    });
  };

  return (
    <form onSubmit={save} className="space-y-3 border-t border-border pt-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Which bank is this?</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Until the first deposit, Stripe doesn&apos;t tell us the bank. Add its name and the last 4 digits so your team
          can tell accounts apart. Never enter the full account number here.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-bank`}>Bank name</Label>
          <Input
            id={`${id}-bank`}
            value={bankName}
            maxLength={80}
            placeholder="Community Bank"
            onChange={(e) => setBankName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-last4`}>Last 4 digits</Label>
          <Input
            id={`${id}-last4`}
            value={last4}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            pattern="[0-9]{4}"
            placeholder="1234"
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending}>
        Save bank name
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Coming back from Stripe
// ---------------------------------------------------------------------------

/**
 * `?account=<id>&stripe_return=1`: read the account's state from Stripe now
 * rather than waiting for the webhook. `&stripe_refresh=1`: Stripe's link
 * expired, so make a fresh one and go straight back.
 */
function StripeReturnHandler({
  params,
  accounts,
}: {
  params: NonNullable<StripeReturnParams>;
  accounts: FundsBankAccount[];
}) {
  const router = useRouter();
  const ran = useRef(false);
  const [busy, setBusy] = useState(true);
  const label = accounts.find((a) => a.id === params.accountRowId)?.label ?? "this bank account";

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      if (params.mode === "refresh") {
        const failed = await goToStripe(params.accountRowId);
        if (!failed) return; // Leaving for Stripe.
        toast.error(failed);
        setBusy(false);
        router.replace(PAGE_PATH);
        return;
      }
      try {
        const result = await refreshFundAccount(params.accountRowId);
        if (result.error) {
          toast.error(result.error);
        } else if (result.canTakeGifts) {
          toast.success(`${label} is ready. Its funds can take gifts now.`);
        } else {
          toast.info(`Thanks. Stripe is still checking a few details for ${label}. We'll show here what's left.`);
        }
      } catch {
        toast.error("We couldn't check this bank account with Stripe. Open it below and choose Check again.");
      }
      setBusy(false);
      router.replace(PAGE_PATH);
    })();
  }, [label, params, router]);

  if (!busy) return null;
  return (
    <Card className="flex items-center gap-4 p-6" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
      <p className="text-base font-semibold text-foreground">
        {params.mode === "refresh" ? `Taking you back to Stripe for ${label}…` : `Checking ${label} with Stripe…`}
      </p>
    </Card>
  );
}
