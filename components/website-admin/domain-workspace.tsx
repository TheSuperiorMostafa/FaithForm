"use client";

import { useState, useTransition } from "react";
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

import {
  cancelDomainRequest,
  recheckDomainDns,
  removeDomain,
  submitDomainRequest,
} from "@/app/dashboard/website/domain-actions";
import {
  domainInstructionsMailto,
  domainStatusWords,
} from "@/components/website-admin/website-words";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
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

type DomainWithRecords = SiteDomainDetail & { records: DnsRecord[] };

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
};

export function DomainWorkspace(props: Props) {
  const { domains, openRequest, canEdit } = props;
  const [choice, setChoice] = useState<"connect" | "register" | null>(null);

  const live = domains.find((d) => d.status === "live");

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
          description="Where people find your website. Your free FaithForm address always works; you can also use your own."
        />
      </div>

      <CurrentAddress
        live={live ?? null}
        faithformAddress={props.faithformAddress}
        previewUrl={props.previewUrl}
      />

      {domains.map((domain) => (
        <DomainCard
          key={domain.id}
          domain={domain}
          canEdit={canEdit}
          automated={props.automated}
          churchName={props.churchName}
          hasFaithformAddress={Boolean(props.faithformAddress)}
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

function CurrentAddress({
  live,
  faithformAddress,
  previewUrl,
}: {
  live: SiteDomainDetail | null;
  faithformAddress: string | null;
  previewUrl: string | null;
}) {
  const url = live
    ? `https://${live.hostname}`
    : faithformAddress
      ? `https://${faithformAddress}`
      : previewUrl;

  const label = live?.hostname ?? faithformAddress ?? "Preview link";

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold">Address that works today</h3>
          <p className="mt-0.5 text-[15px] text-muted-foreground">
            {live
              ? "This is the address visitors see."
              : faithformAddress
                ? "This address works now, with no setup. Connect your own below if you'd like to replace it."
                : "Your site is reachable at the preview link while you set an address up."}
          </p>
        </div>
        {live ? <StatusBadge tone="done">Connected</StatusBadge> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-2">
        <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-base font-medium">{label}</span>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost">
              Open
              <ExternalLink className="size-4" aria-hidden />
            </Button>
          </a>
        ) : null}
      </div>
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
}: {
  domain: DomainWithRecords;
  canEdit: boolean;
  automated: boolean;
  churchName: string | null;
  hasFaithformAddress: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [removing, startRemoving] = useTransition();
  const [route, setRoute] = useState<"self" | null>(null);
  const router = useRouter();
  const status = domainStatusWords(domain.status, automated);
  const needsSetup = domain.status === "pending_dns" || domain.status === "failed";

  function recheck() {
    startTransition(async () => {
      const result = await recheckDomainDns(domain.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.status === "live") toast.success(`${domain.hostname} is connected.`);
      else if (result.dnsOk) toast.success(`The settings for ${domain.hostname} are correct.`);
      else
        toast.message(`${domain.hostname} isn't connected yet`, {
          description:
            "Your domain company hasn't passed the change on yet. Give it a few more minutes, then check again.",
        });
      router.refresh();
    });
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Remove ${domain.hostname}?`,
      description: hasFaithformAddress
        ? `Visitors who type ${domain.hostname} will no longer reach your website. Your free FaithForm address keeps working, and you can connect ${domain.hostname} again later.`
        : `Visitors who type ${domain.hostname} will no longer reach your website. You can connect it again later.`,
      confirmLabel: "Remove web address",
      destructive: true,
    });
    if (!ok) return;

    startRemoving(async () => {
      const result = await removeDomain(domain.id);
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
    records: domain.records,
    churchName,
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-bold">{domain.hostname}</h3>
            {domain.isPrimary ? (
              <span className="text-sm font-medium text-muted-foreground">Main address</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[15px] text-muted-foreground">{status.detail}</p>
        </div>
        <StatusBadge tone={status.tone as StatusTone}>{status.label}</StatusBadge>
      </div>

      {needsSetup ? (
        <div className="mt-5 flex flex-col gap-4">
          <h4 className="text-base font-semibold">How would you like to finish?</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <RouteCard
              icon={Wrench}
              title="I'll do it myself"
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
                Email these steps to the person who manages our domain
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
                We already have your request. Contact us and we&apos;ll walk through it with you.
              </span>
            </Link>
          </div>

          {route === "self" ? (
            <ol className="flex list-decimal flex-col gap-2 rounded-xl border border-border bg-muted/30 py-4 pl-10 pr-4 text-[15px]">
              <li>Sign in wherever you bought {domain.hostname} (for example GoDaddy or Namecheap).</li>
              <li>Open the settings called &ldquo;DNS&rdquo; or &ldquo;Manage DNS&rdquo;.</li>
              <li>Add the settings shown under Technical details below. Copy each value exactly.</li>
              <li>Leave any email settings alone. These only affect the website.</li>
              <li>Come back here and choose &ldquo;Check again&rdquo;.</li>
            </ol>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {canEdit && domain.status !== "live" ? (
          <Button variant="outline" onClick={recheck} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Check again
          </Button>
        ) : null}
        {domain.dnsCheckedAt && domain.status !== "live" ? (
          <span className="text-sm text-muted-foreground">
            We check on our own too. Last checked {relativeTime(domain.dnsCheckedAt)}.
          </span>
        ) : null}
        {canEdit ? (
          <Button
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={remove}
            disabled={removing}
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

      {domain.status !== "live" ? (
        <AdvancedSection
          title="Technical details"
          description="The exact settings your domain company needs."
          className="mt-5"
        >
          <ul className="flex flex-col gap-3">
            {domain.records.map((record) => (
              <li
                key={`${record.type}-${record.name}`}
                className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4"
              >
                <p className="text-[15px] text-muted-foreground">{record.note}</p>
                <dl className="grid gap-3 sm:grid-cols-[8rem_10rem_minmax(0,1fr)]">
                  <RecordValue label="Type" value={record.type} />
                  <RecordValue label="Name / Host" value={record.name} />
                  <RecordValue label="Value / Points to" value={record.value} copy />
                </dl>
              </li>
            ))}
          </ul>
          {domain.dnsDetail ? (
            <p className="text-sm text-muted-foreground">Last check: {domain.dnsDetail}</p>
          ) : null}
        </AdvancedSection>
      ) : null}
    </section>
  );
}

function RecordValue({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-center gap-2">
        <span className="break-all font-mono text-base">{value}</span>
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Copy ${value}`}
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
      {copied ? "Copied" : "Copy"}
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
        An address like gracechurch.org is easy to remember and looks right on a
        bulletin. Pick whichever suits you. Both end in the same place.
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
          body="Tell us the name you'd like. We'll check it's free, register it, and set it all up with you."
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
      const result = await submitDomainRequest({
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
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        result.kind === "connect_existing"
          ? `${result.hostname} added. The steps to finish are below.`
          : "Request sent. We'll be in touch within one business day.",
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
            : "Give us a name or two you'd like. We'll check what's free, register it, and walk the setup through with you."}
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
        <Field label="Who should we talk to?">
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

      {connecting ? (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            If you use email on this address, it keeps working. The settings we
            ask for only affect the website.
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
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[15px] font-semibold">{label}</Label>
      {children}
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
    body: "We have your request and will pick it up within one business day.",
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
      description: `FaithForm will stop working on ${
        request.hostname ?? "your web address"
      }. Any address already connected stays connected, and you can send a new request later.`,
      confirmLabel: "Cancel request",
      cancelLabel: "Keep request",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await cancelDomainRequest(request.id);
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
