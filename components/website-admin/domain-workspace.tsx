"use client";

import { cloneElement, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { websiteActionRequest } from "./action-request";

import {
  cancelDomainRequest,
  recheckDomainDns,
  removeDomain,
  submitDomainRequest,
} from "@/app/dashboard/website/domain-actions";
import {
  domainInstructionsMailto,
  domainInstructionsText,
  domainStatusWords,
} from "@/components/website-admin/website-words";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type {
  DomainRequestStatus,
  SiteDomainDetail,
  SiteDomainRequest,
} from "@/lib/sites/domain-queries";
import type { DnsRecord } from "@/lib/sites/domains";
import { cn } from "@/lib/utils";

/**
 * Website → Your web address (reached from the Overview card).
 *
 * The page is a ladder, not a menu. A church always has a working address, may
 * have a domain part-way through setup, and may have asked us for one. Each of
 * those is a card, ordered by urgency, and the "start something new" chooser
 * only appears when there is nothing already in flight — otherwise a pastor
 * mid-setup is offered a second path and takes it, and now we have two.
 *
 * Technical settings (record type, name, value) sit behind "Technical details";
 * the default view speaks in plain statuses and offers three equal ways to get
 * the job done: do it yourself, email the steps to whoever manages the domain,
 * or let FaithForm do it.
 */

export type DomainSetup = {
  phase: "connecting" | "ownership" | "dns" | "https" | "ready" | "attention";
  title: string;
  description: string;
  checkedAt: string | null;
  nextCheckAt: string | null;
  records: DnsRecord[];
  verification: DnsRecord[];
  retryable: boolean;
};

type DomainWithRecords = SiteDomainDetail & { records: DnsRecord[]; setup?: DomainSetup; redirectTo?: string | null };

type Props = {
  domains: DomainWithRecords[];
  openRequest: SiteDomainRequest | null;
  history: SiteDomainRequest[];
  faithformAddress: string | null;
  previewUrl: string | null;
  canEdit: boolean;
  churchName: string | null;
  defaults: { contactName: string | null; contactEmail: string | null };
  automated: boolean;
  publicUrl?: string | null;
  isPublished?: boolean;
};

export function DomainWorkspace(props: Props) {
  const { domains, openRequest, canEdit } = props;
  const canonicalDomains = domains.filter((domain) => !domain.redirectTo || !domains.some((target) => target.hostname === domain.redirectTo));
  const connections = canonicalDomains;
  const [choice, setChoice] = useState<"connect" | "register" | null>(null);

  const live = canonicalDomains.find((domain) => domain.isPrimary && domain.status === "live")
    ?? canonicalDomains.find((domain) => domain.status === "live");
  const familyReady = connections.some((domain) => domain.setup ? domain.setup.phase === "ready" : domain.status === "live");
  const waiting = domains.some((domain) => domain.setup ? domain.setup.phase !== "ready" : domain.status !== "live");
  useDomainRefresh(waiting);
  const isPublished = props.isPublished === true;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/website"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl px-2 text-[15px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to Overview
        </Link>
        <SectionHeader
          title="Your web address"
          description="Connect your church’s address, check it, then publish when you’re ready."
        />
      </div>

      <SetupProgress hasAddress={domains.length > 0} connected={familyReady} published={isPublished} />

      <CurrentAddress
        live={live ?? null}
        faithformAddress={props.faithformAddress}
        previewUrl={props.previewUrl}
        publicUrl={props.publicUrl ?? null}
        isPublished={isPublished}
      />

      {connections.map((domain) => (
        <DomainCard
          key={domain.id}
          domain={domain}
          canEdit={canEdit}
          automated={props.automated}
          churchName={props.churchName}
          hasFaithformAddress={Boolean(props.publicUrl && !props.publicUrl.startsWith(`https://${domain.hostname}`))}
          isPublished={isPublished}
          aliases={domains.filter((alias) => alias.redirectTo === domain.hostname).map((alias) => alias.hostname)}
        />
      ))}

      {openRequest ? (
        <RequestCard request={openRequest} canEdit={canEdit} />
      ) : canEdit ? (
        choice === null ? (
          <Chooser onChoose={setChoice} hasDomain={domains.length > 0} />
        ) : (
          <RequestForm
            kind={choice}
            defaults={props.defaults}
            onCancel={() => setChoice(null)}
          />
        )
      ) : (
        <p className="text-[15px] text-muted-foreground">
          Only church admins can set up a web address.
        </p>
      )}

      {props.history.length > 0 ? <History requests={props.history} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CURRENT ADDRESS
// ---------------------------------------------------------------------------

/** Refreshes saved progress without changing a church’s settings on page load. */
function useDomainRefresh(waiting: boolean) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;

  useEffect(() => {
    if (!waiting) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || refreshingRef.current) return;
      refreshingRef.current = true;
      startRefresh(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, waiting]);
}

function SetupProgress({ hasAddress, connected, published }: { hasAddress: boolean; connected: boolean; published: boolean }) {
  const steps = [
    { label: "Choose an address", complete: hasAddress, current: !hasAddress },
    { label: "Connect your address", complete: connected, current: hasAddress && !connected },
    { label: "Publish your website", complete: published, current: connected && !published },
  ];
  return (
    <ol aria-label="Website setup" className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.label} aria-current={step.current ? "step" : undefined} className={cn("flex items-center gap-3 rounded-2xl border p-4", step.current ? "border-accent bg-accent/5" : "border-border bg-card")}>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", step.complete ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-muted text-foreground")}>
            {step.complete ? <Check className="size-4" aria-hidden /> : index + 1}
          </span>
          <span className="text-sm font-semibold">{step.label}<span className="sr-only">{step.complete ? ": complete" : step.current ? ": current step" : ": upcoming"}</span></span>
        </li>
      ))}
    </ol>
  );
}

function CurrentAddress({ live, faithformAddress, previewUrl, publicUrl, isPublished }: {
  live: SiteDomainDetail | null;
  faithformAddress: string | null;
  previewUrl: string | null;
  publicUrl: string | null;
  isPublished: boolean;
}) {
  const liveUrl = isPublished ? (publicUrl ?? (live ? `https://${live.hostname}` : null)) : null;
  const label = live?.hostname ?? faithformAddress ?? (liveUrl ? liveUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Your website preview");
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold">Your website address</h3>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {liveUrl
              ? "Your website is published. Visitors can open it at this address."
              : live
                ? "Your address is connected. Review your draft, then publish it from Overview."
                : "You can review your saved website while your address is being connected."}
          </p>
        </div>
        <StatusBadge tone={liveUrl ? "done" : "neutral"}>{liveUrl ? "Published" : "Not published"}</StatusBadge>
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex w-full min-w-0 items-start gap-3 sm:min-w-56 sm:flex-1">
          <Globe className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 break-words text-base font-medium">{label}</span>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {liveUrl ? <a href={liveUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}><ExternalLink className="size-4" aria-hidden />Visit website</a> : null}
          {previewUrl ? <a href={previewUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "ghost" }), "w-full sm:w-auto")}><ExternalLink className="size-4" aria-hidden />Review preview</a> : null}
        </div>
      </div>
      {!isPublished && live ? <Link href="/dashboard/website" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}><ArrowRight className="size-4" aria-hidden />Review and publish</Link> : null}
      {!isPublished ? <p className="mt-3 text-sm text-muted-foreground">Preview links are for your signed-in team. Connecting an address does not publish your website.</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A CONNECTED DOMAIN
// ---------------------------------------------------------------------------

function DomainCard({
  domain,
  canEdit,
  automated,
  churchName,
  hasFaithformAddress,
  isPublished,
  aliases,
}: {
  domain: DomainWithRecords;
  canEdit: boolean;
  automated: boolean;
  churchName: string | null;
  hasFaithformAddress: boolean;
  isPublished: boolean;
  aliases: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [removing, startRemoving] = useTransition();
  const [route, setRoute] = useState<"self" | null>(null);
  const router = useRouter();
  const status = domainStatusWords(domain.status, automated);
  const setup = domain.setup;
  const phase = setup?.phase ?? (domain.status === "live" ? "ready" : domain.status === "dns_ok" ? "https" : domain.status === "failed" ? "attention" : "dns");
  const needsSetup = phase === "ownership" || phase === "dns" || phase === "attention";
  const records = [...(setup?.verification ?? []), ...(setup?.records ?? domain.records)];
  const statusTitle = setup?.title ?? status.label;
  const statusDescription = setup?.description ?? status.detail;

  function recheck() {
    startTransition(async () => {
      const result = await websiteActionRequest(() => recheckDomainDns(domain.id));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.message("Connection check scheduled", {
        description: "Your progress will update here. You can leave this page while the check finishes.",
      });
      router.refresh();
    });
  }

  async function remove() {
    const ok = await confirmAction({
      title: "Remove this web address?",
      description: <span tabIndex={0} className="block max-h-[calc(100dvh-18rem)] overflow-y-auto rounded-sm break-words [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {hasFaithformAddress
          ? `Visitors who type ${domain.hostname} will no longer reach your website. Your published website stays available at its FaithForm address, and you can connect ${domain.hostname} again later.`
          : `Visitors who type ${domain.hostname} will no longer reach your website. You can connect it again later.`}
      </span>,
      confirmLabel: "Remove web address",
      destructive: true,
    });
    if (!ok) return;

    startRemoving(async () => {
      const result = await websiteActionRequest(() => removeDomain(domain.id));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${domain.hostname} removed from your website.`);
      router.refresh();
    });
  }

  const mailto = domainInstructionsMailto({
    hostname: domain.hostname,
    records,
    churchName,
    automatic: automated,
  });
  const instructions = domainInstructionsText({ hostname: domain.hostname, records, churchName, automatic: automated });

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-heading text-lg font-bold [overflow-wrap:anywhere]">{domain.hostname}</h3>
            {domain.isPrimary ? (
              <span className="text-sm font-medium text-muted-foreground">Main address</span>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] text-muted-foreground">{statusDescription}</p>
          {aliases.length > 0 ? <p className="mt-2 break-words text-sm text-muted-foreground">{phase === "ready" ? "Also connects" : "Includes"} {aliases.join(", ")}{phase === "ready" ? " and sends visitors to this address." : ". Both versions are checked before setup is complete."}</p> : null}
        </div>
        <StatusBadge className="max-w-full whitespace-normal" tone={phase === "ready" ? "done" : phase === "attention" || phase === "ownership" ? "attention" : "working"}>{statusTitle}</StatusBadge>
      </div>

      {phase === "ready" ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">{isPublished ? "This address is connected to your published website." : "Your address is ready. Review your saved website before publishing."}</p>
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[15px]">
          <p className="font-semibold">{needsSetup ? "Next step: update your website settings" : "FaithForm is finishing the connection"}</p>
          <p className="mt-1 text-muted-foreground">{needsSetup ? "Use the connection settings below, or hand the instructions to the person who looks after your address." : automated ? "We’ll keep checking in the background. You can leave this page and come back." : "Your request is saved. The FaithForm team needs to finish the connection."}</p>
        </div>
      )}

      {needsSetup ? (
        <div className="mt-5 flex flex-col gap-4">
          <h4 className="text-base font-semibold">Choose who will update the settings</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <RouteCard
              icon={Wrench}
              title="Show connection settings"
              body="Step-by-step, with the settings to copy."
              selected={route === "self"}
              onClick={() => setRoute(route === "self" ? null : "self")}
            />
            <a
              href={mailto}
              className="flex flex-col items-start gap-2 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Mail className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-base font-semibold">
                Email instructions to our IT person
              </span>
              <span className="text-sm text-muted-foreground">
                Opens your email with the instructions filled in.
              </span>
            </a>
            <Link
              href="/dashboard/support"
              className="flex flex-col items-start gap-2 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Sparkles className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-base font-semibold">Let FaithForm do it for me</span>
              <span className="text-sm text-muted-foreground">
                Ask our team to help finish this connection.
              </span>
            </Link>
          </div>

          {route === "self" ? (
            <ol className="flex list-decimal flex-col gap-2 rounded-xl border border-border bg-muted/30 py-4 pl-10 pr-4 text-[15px]">
              <li>Sign in to the company that manages the settings for {domain.hostname}. This may be different from the company where you bought it.</li>
              <li>Open the settings called &ldquo;DNS&rdquo; or &ldquo;Manage DNS&rdquo;.</li>
              <li>Add the settings shown under Technical details below. Copy each value exactly.</li>
              <li>Leave any email settings alone. These only affect the website.</li>
              <li>{automated ? "FaithForm checks the connection automatically. You can leave this page while it finishes." : "After saving the settings, choose Check again so the FaithForm team can finish."}</li>
            </ol>
          ) : null}
        </div>
      ) : null}

      {needsSetup ? <div className="mt-4"><CopyButton value={instructions} label="Copy instructions for our IT person" /></div> : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {canEdit && phase !== "ready" ? (
          <Button variant="outline" onClick={recheck} disabled={pending || removing}>
            {pending ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Check again
          </Button>
        ) : null}
        {(setup?.checkedAt ?? domain.dnsCheckedAt) ? <p className="text-sm text-muted-foreground">Last checked {relativeTime((setup?.checkedAt ?? domain.dnsCheckedAt)!)}.{phase !== "ready" && setup?.nextCheckAt && automated ? " Another check is scheduled." : ""}</p> : null}
        {canEdit ? (
          <Button
            variant="ghost"
            className="ml-auto h-auto min-h-11 max-w-full whitespace-normal text-left text-destructive hover:text-destructive"
            onClick={remove}
            disabled={removing || pending}
          >
            {removing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            Remove this web address
          </Button>
        ) : null}
      </div>

      {phase !== "ready" ? (
        <AdvancedSection
          title="Technical details"
          description="Exact connection settings to copy or give to your IT person."
          forceOpen={route === "self"}
          className="mt-5"
        >
          <ul className="flex flex-col gap-3">
            {records.map((record) => (
              <li
                key={`${record.type}-${record.name}-${record.value}`}
                className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4"
              >
                <p className="text-[15px] text-muted-foreground">{record.note}</p>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[6rem_minmax(8rem,1fr)_minmax(0,2fr)]">
                  <RecordValue label="Type" value={record.type} />
                  <RecordValue label="Name / Host" value={record.name} copy />
                  <RecordValue label="Value / Points to" value={record.value} copy className="sm:col-span-2 lg:col-span-1" />
                </dl>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">Update only the website records shown here. Keep email, verification, and other existing records in place. If you are unsure, send these instructions to your IT person.</p>
        </AdvancedSection>
      ) : null}
    </section>
  );
}

function RecordValue({ label, value, copy, className }: { label: string; value: string; copy?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 flex-col items-start gap-2">
        <span className="w-full break-all font-mono text-base">{value}</span>
        {copy ? <CopyButton value={value} /> : null}
      </dd>
    </div>
  );
}

function RouteCard({
  icon: Icon,
  title,
  body,
  selected,
  onClick,
}: {
  icon: typeof Globe;
  title: string;
  body: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={selected}
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl border bg-background p-4 text-left transition-colors hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-accent bg-accent/5" : "border-border",
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-base font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{body}</span>
    </button>
  );
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="outline"
      className="h-auto min-h-11 max-w-full whitespace-normal text-left"
      aria-label={label === "Copy" ? `Copy ${value}` : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Couldn't copy. Select the value and copy it yourself.");
        }
      }}
    >
      {copied ? (
        <Check className="size-4 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// CHOOSER
// ---------------------------------------------------------------------------

function Chooser({
  onChoose,
  hasDomain,
}: {
  onChoose: (choice: "connect" | "register") => void;
  hasDomain: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <h3 className="font-heading text-lg font-bold">
        {hasDomain ? "Add another address" : "Use your own address"}
      </h3>
      <p className="mt-0.5 text-[15px] text-muted-foreground">
        Connect an address you own, or ask FaithForm for help choosing a new one.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          icon={Globe}
          title="Connect an address I already own"
          body="Type it in and we'll give you the steps. Do them yourself or email them to whoever manages it."
          cta="Connect my address"
          onClick={() => onChoose("connect")}
        />
        <ChoiceCard
          icon={Sparkles}
          title="Let FaithForm do it for me"
          body="Ask us to check availability and help you register and connect an address."
          cta="Ask FaithForm"
          onClick={() => onChoose("register")}
        />
      </div>
    </section>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  body,
  cta,
  onClick,
}: {
  icon: typeof Globe;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-background p-5 text-left transition-colors hover:border-accent hover:bg-accent/5 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-base font-semibold">{title}</span>
      <span className="text-[15px] leading-relaxed text-muted-foreground">{body}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-[15px] font-semibold text-accent">
        {cta}
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden
        />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// REQUEST FORM
// ---------------------------------------------------------------------------

function RequestForm({
  kind,
  defaults,
  onCancel,
}: {
  kind: "connect" | "register";
  defaults: { contactName: string | null; contactEmail: string | null };
  onCancel: () => void;
}) {
  const connecting = kind === "connect";
  const [hostname, setHostname] = useState("");
  const [alternates, setAlternates] = useState("");
  const [registrar, setRegistrar] = useState("");
  const [contactName, setContactName] = useState(defaults.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(defaults.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await websiteActionRequest(() => submitDomainRequest({
        kind: connecting ? "connect_existing" : "register_new",
        hostname,
        alternateHostnames: connecting
          ? []
          : alternates
              .split(/[,\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
        registrar: connecting ? registrar : "",
        contactName,
        contactEmail,
        contactPhone,
        notes,
      }));

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        result.kind === "connect_existing"
          ? `${result.hostname} added. The steps to finish are below.`
          : "Your address request is saved. You can follow its progress here.",
      );
      onCancel();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <div>
        <h3 className="font-heading text-lg font-bold">
          {connecting ? "Connect your address" : "Let FaithForm do it for you"}
        </h3>
        <p className="mt-0.5 text-[15px] text-muted-foreground">
          {connecting
            ? "We'll add it straight away and show you the steps to finish at your domain company."
            : "Tell us which names you like. Our team will check availability and arrange the next steps with you."}
        </p>
      </div>

      <Field
        label={connecting ? "Your address" : "Address you'd like"}
        hint={
          connecting
            ? "Just the address, like gracechurch.org."
            : "Your first choice. We'll tell you if it's taken."
        }
      >
        <Input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="gracechurch.org"
          autoComplete="off"
          spellCheck={false}
          required={connecting}
        />
      </Field>

      <AdvancedSection title="Setup contact and notes" description="Optional: name your IT person, domain company, or anything our team should know.">
      {connecting ? (
        <Field
          label="Where did you buy it?"
          hint="Optional. It helps us give you the exact steps for that company."
        >
          <Input
            value={registrar}
            onChange={(e) => setRegistrar(e.target.value)}
            placeholder="GoDaddy, Namecheap, Squarespace…"
          />
        </Field>
      ) : (
        <Field
          label="Other names you'd accept"
          hint="One per line. Good names go fast, so a backup saves a day of back and forth."
        >
          <Textarea
            value={alternates}
            onChange={(e) => setAlternates(e.target.value)}
            rows={3}
            placeholder={"gracechurchlouisville.org\ngracechurch.church"}
          />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Person handling this address" hint="Your office contact or IT person.">
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Pastor Dave"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="office@gracechurch.org"
          />
        </Field>
      </div>

      <Field label="Phone" hint="Optional. Often the quickest way to sort this out.">
        <Input
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          placeholder="(502) 555-0134"
        />
      </Field>

      <Field label="Anything else we should know?">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={
            connecting
              ? "We have email on this address too. Please don't break it."
              : "We'd like something short. The old site is at gracechurch.weebly.com."
          }
        />
      </Field>
      </AdvancedSection>

      {connecting ? (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Update only the website settings we provide. Keep existing email
            and verification records in place, or ask your IT person to help.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {connecting ? "Connect address" : "Send request"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Back
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[15px] font-semibold">{label}</Label>
      {cloneElement(children as React.ReactElement<{ id?: string }>, { id })}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OPEN REQUEST
// ---------------------------------------------------------------------------

/**
 * Church-facing wording for each status. The internal vocabulary
 * ("in_review") is for the control center; a pastor should read what is
 * happening and whether the ball is with them.
 */
const REQUEST_STATUS: Record<
  DomainRequestStatus,
  { label: string; tone: StatusTone; body: string }
> = {
  submitted: {
    label: "Received",
    tone: "working",
    body: "Your request is saved for the FaithForm team. Updates will appear here.",
  },
  in_review: {
    label: "Looking into it",
    tone: "working",
    body: "We're checking availability and working out the setup.",
  },
  awaiting_church: {
    label: "Needs you",
    tone: "attention",
    body: "We need something from you before we can carry on. See the note below.",
  },
  in_progress: {
    label: "Setting it up",
    tone: "working",
    body: "We're registering the address and connecting it to your site.",
  },
  completed: {
    label: "Done",
    tone: "done",
    body: "Your address is set up.",
  },
  declined: {
    label: "Closed",
    tone: "neutral",
    body: "We couldn't go ahead with this one. See the note below.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    body: "You cancelled this request.",
  },
};

function RequestCard({
  request,
  canEdit,
}: {
  request: SiteDomainRequest;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const status = REQUEST_STATUS[request.status];
  const cancellable =
    canEdit &&
    ["submitted", "in_review", "awaiting_church"].includes(request.status);

  async function cancel() {
    const ok = await confirmAction({
      title: "Cancel this request?",
      description: <span tabIndex={0} className="block max-h-[calc(100dvh-18rem)] overflow-y-auto rounded-sm break-words [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {`FaithForm will stop working on ${request.hostname ?? "your web address"}. Any address already connected stays connected, and you can send a new request later.`}
      </span>,
      confirmLabel: "Cancel request",
      cancelLabel: "Keep request",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await websiteActionRequest(() => cancelDomainRequest(request.id));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Web address request cancelled.");
      router.refresh();
    });
  }

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-6 shadow-card",
        request.status === "awaiting_church"
          ? "border-amber-300 dark:border-amber-500/40"
          : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold">
            {request.kind === "register_new"
              ? "We're getting you an address"
              : "FaithForm is helping with your address"}
          </h3>
          <p className="mt-0.5 text-[15px] text-muted-foreground">{status.body}</p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {request.hostname ? (
          <Detail
            label={request.kind === "register_new" ? "First choice" : "Address"}
            value={request.hostname}
          />
        ) : null}
        {request.alternateHostnames.length > 0 ? (
          <Detail label="Alternatives" value={request.alternateHostnames.join(", ")} />
        ) : null}
        <Detail label="Requested" value={relativeTime(request.createdAt)} />
      </dl>

      {request.adminNotes ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <div className="text-sm font-semibold text-muted-foreground">Note from FaithForm</div>
          <p className="mt-1 whitespace-pre-line text-[15px]">{request.adminNotes}</p>
        </div>
      ) : null}

      {cancellable ? (
        <Button variant="ghost" className="mt-4" disabled={pending} onClick={cancel}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Cancel this request
        </Button>
      ) : null}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{value}</dd>
    </div>
  );
}

function History({ requests }: { requests: SiteDomainRequest[] }) {
  return (
    <AdvancedSection title={`Earlier requests (${requests.length})`}>
      <ul className="flex flex-col gap-2">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3"
          >
            <span className="text-[15px] font-medium">
              {request.hostname ?? "No address named"}
            </span>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {relativeTime(request.createdAt)}
              <StatusBadge tone={REQUEST_STATUS[request.status].tone}>
                {REQUEST_STATUS[request.status].label}
              </StatusBadge>
            </span>
          </li>
        ))}
      </ul>
    </AdvancedSection>
  );
}

// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
