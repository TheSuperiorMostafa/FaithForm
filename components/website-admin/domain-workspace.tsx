"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  ShoppingCart,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelDomainRequest,
  recheckDomainDns,
  submitDomainRequest,
} from "@/app/dashboard/website/domain-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  DomainRequestStatus,
  SiteDomainDetail,
  SiteDomainRequest,
} from "@/lib/sites/domain-queries";
import type { DnsRecord } from "@/lib/sites/domains";
import { cn } from "@/lib/utils";

/**
 * The Website → Domain tab.
 *
 * The page is a ladder, not a menu. A church always has a working address, may
 * have a domain part-way through setup, and may have asked us for one. Each of
 * those is a card, ordered by urgency, and the "start something new" chooser
 * only appears when there is nothing already in flight — otherwise a pastor
 * mid-setup is offered a second path and takes it, and now we have two.
 */

type DomainWithRecords = SiteDomainDetail & { records: DnsRecord[] };

type Props = {
  domains: DomainWithRecords[];
  openRequest: SiteDomainRequest | null;
  history: SiteDomainRequest[];
  faithformAddress: string | null;
  previewUrl: string | null;
  canEdit: boolean;
  defaults: { contactName: string | null; contactEmail: string | null };
  automated: boolean;
};

export function DomainWorkspace(props: Props) {
  const { domains, openRequest, canEdit } = props;
  const [choice, setChoice] = useState<"connect" | "register" | null>(null);

  const live = domains.find((d) => d.status === "live");

  return (
    <div className="flex flex-col gap-5">
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
        <p className="text-sm text-muted-foreground">
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
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold">Your web address</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {live
              ? "This is the address visitors see."
              : faithformAddress
                ? "This address works today — no setup needed. Connect your own domain below to replace it."
                : "Your site is reachable at the preview link while you set an address up."}
          </p>
        </div>
        {live ? <Badge variant="success">Live</Badge> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{label}</span>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="xs">
              Open
              <ExternalLink className="size-3.5" aria-hidden />
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

const DOMAIN_STATUS: Record<
  SiteDomainDetail["status"],
  { label: string; variant: "success" | "info" | "warning" | "destructive" }
> = {
  live: { label: "Live", variant: "success" },
  dns_ok: { label: "DNS verified", variant: "info" },
  pending_dns: { label: "Waiting on DNS", variant: "warning" },
  failed: { label: "Needs attention", variant: "destructive" },
};

function DomainCard({
  domain,
  canEdit,
  automated,
}: {
  domain: DomainWithRecords;
  canEdit: boolean;
  automated: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const status = DOMAIN_STATUS[domain.status];

  function recheck() {
    startTransition(async () => {
      const result = await recheckDomainDns(domain.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.status === "live") toast.success(`${domain.hostname} is live.`);
      else if (result.dnsOk) toast.success(result.detail);
      else toast.message("Not pointing here yet", { description: result.detail });
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-bold">{domain.hostname}</h2>
            {domain.isPrimary ? <Badge variant="muted">Primary</Badge> : null}
          </div>
          {domain.dnsDetail ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {domain.dnsDetail}
            </p>
          ) : null}
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {domain.status === "live" ? null : (
        <>
          <div className="mt-5">
            <h3 className="text-sm font-semibold">
              Add these records at your domain provider
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sign in wherever you bought {domain.hostname} and open its DNS
              settings. Changes usually take a few minutes, occasionally an hour.
            </p>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-semibold">Type</th>
                  <th className="pb-2 pr-3 font-semibold">Name</th>
                  <th className="pb-2 pr-3 font-semibold">Value</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {domain.records.map((record) => (
                  <tr key={`${record.type}-${record.name}`}>
                    <td className="border-t border-border py-2.5 pr-3 align-top font-mono text-xs">
                      {record.type}
                    </td>
                    <td className="border-t border-border py-2.5 pr-3 align-top font-mono text-xs">
                      {record.name}
                    </td>
                    <td className="border-t border-border py-2.5 pr-3 align-top">
                      <div className="font-mono text-xs">{record.value}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {record.note}
                      </div>
                    </td>
                    <td className="border-t border-border py-2.5 align-top">
                      <CopyButton value={record.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={recheck}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-4" aria-hidden />
                )}
                Check now
              </Button>
            ) : null}
            {domain.dnsCheckedAt ? (
              <span className="text-xs text-muted-foreground">
                Last checked {relativeTime(domain.dnsCheckedAt)}
              </span>
            ) : null}
          </div>

          {domain.status === "dns_ok" ? (
            <p className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {automated
                ? "Your records are correct. We're issuing the security certificate — this finishes on its own, usually within a few minutes."
                : "Your records are correct and your part is done. We'll switch the domain on from our side and email you when it's live."}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Couldn't copy — select the value and copy it manually.");
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-green-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
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
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="font-heading text-lg font-bold">
        {hasDomain ? "Add another address" : "Use your own domain"}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        A domain like gracechurch.org is what people remember and what looks
        right on a bulletin. Either bring one you already own, or we&apos;ll get
        one for you.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          icon={Globe}
          title="I already have a domain"
          body="You own it and can sign in to your provider. We'll show you the two records to add and check them for you."
          cta="Connect it"
          onClick={() => onChoose("connect")}
        />
        <ChoiceCard
          icon={ShoppingCart}
          title="I need a domain"
          body="Tell us what you'd like to be called. We'll check what's available, register it, and set the whole thing up with you."
          cta="Ask us to set one up"
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
      className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-accent hover:bg-accent/5 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent">
        {cta}
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
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
          ? `${result.hostname} added — your DNS records are below.`
          : "Request sent. We'll be in touch within one business day.",
      );
      onCancel();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card"
    >
      <div>
        <h2 className="font-heading text-lg font-bold">
          {connecting ? "Connect your domain" : "Ask us to set up a domain"}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {connecting
            ? "We'll add it straight away and show you the records to enter at your provider."
            : "Give us a name or two you'd like. We'll check what's free, register it, and walk the setup through with you."}
        </p>
      </div>

      <Field
        label={connecting ? "Your domain" : "Domain you'd like"}
        hint={
          connecting
            ? "Just the domain — gracechurch.org, not the full web address."
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
          hint="Optional, but it means we can give you the exact steps for your provider."
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
          hint="One per line. Good domains go fast — a backup saves a day of back and forth."
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

      <Field label="Phone" hint="Optional. Often the fastest way to sort DNS out.">
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
              ? "We have email on this domain too — please don't break it."
              : "We'd like something short. The old site is at gracechurch.weebly.com."
          }
        />
      </Field>

      {connecting ? (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            If you use email on this domain, leave your MX records alone. The
            records we ask for only affect the website.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {connecting ? "Connect domain" : "Send request"}
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
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
  { label: string; variant: "success" | "info" | "warning" | "muted" | "destructive"; body: string }
> = {
  submitted: {
    label: "Received",
    variant: "info",
    body: "We have your request and will pick it up within one business day.",
  },
  in_review: {
    label: "Looking into it",
    variant: "info",
    body: "We're checking availability and working out the setup.",
  },
  awaiting_church: {
    label: "Needs you",
    variant: "warning",
    body: "We need something from you before we can carry on — see the note below.",
  },
  in_progress: {
    label: "Setting it up",
    variant: "info",
    body: "We're registering the domain and wiring it to your site.",
  },
  completed: {
    label: "Done",
    variant: "success",
    body: "Your domain is set up.",
  },
  declined: {
    label: "Closed",
    variant: "muted",
    body: "We couldn't go ahead with this one — see the note below.",
  },
  cancelled: {
    label: "Cancelled",
    variant: "muted",
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

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-card",
        request.status === "awaiting_church"
          ? "border-amber-300 dark:border-amber-500/40"
          : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold">
            {request.kind === "register_new"
              ? "We're getting you a domain"
              : "Domain setup in progress"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{status.body}</p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {request.hostname ? (
          <Detail
            label={request.kind === "register_new" ? "First choice" : "Domain"}
            value={request.hostname}
            mono
          />
        ) : null}
        {request.alternateHostnames.length > 0 ? (
          <Detail
            label="Alternatives"
            value={request.alternateHostnames.join(", ")}
            mono
          />
        ) : null}
        <Detail label="Requested" value={relativeTime(request.createdAt)} />
      </dl>

      {request.adminNotes ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Note from FaithForm
          </div>
          <p className="mt-1 whitespace-pre-line text-sm">{request.adminNotes}</p>
        </div>
      ) : null}

      {cancellable ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelDomainRequest(request.id);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Request cancelled.");
              router.refresh();
            })
          }
        >
          Cancel this request
        </Button>
      ) : null}
    </section>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("mt-0.5 text-sm", mono && "font-mono text-xs")}>
        {value}
      </dd>
    </div>
  );
}

function History({ requests }: { requests: SiteDomainRequest[] }) {
  return (
    <details className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <summary className="cursor-pointer text-sm font-semibold">
        Earlier requests ({requests.length})
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
          >
            <span className="font-mono text-xs">
              {request.hostname ?? "No domain named"}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {relativeTime(request.createdAt)}
              <Badge variant={REQUEST_STATUS[request.status].variant}>
                {REQUEST_STATUS[request.status].label}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </details>
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
