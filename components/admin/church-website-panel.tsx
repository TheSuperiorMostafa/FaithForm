"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, RefreshCw, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addChurchDomain,
  markDomainLive,
  recheckDomain,
  removeChurchDomain,
  setPrimaryDomain,
  updateDomainRequest,
} from "@/app/admin/domain-actions";
import { formatDateTime } from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  DomainRequestStatus,
  SiteDomainDetail,
  SiteDomainRequest,
} from "@/lib/sites/domain-queries";

/**
 * The Website tab on a church's control-center page.
 *
 * A domain has two halves and this panel is where the platform half gets done:
 * the church points DNS at us, we register the hostname and switch it on. The
 * DNS column is read-only status — nothing here can fix a church's records, so
 * the only actions offered are ours to take.
 */

type Props = {
  churchId: string;
  churchName: string;
  domains: SiteDomainDetail[];
  requests: SiteDomainRequest[];
  /** True when VERCEL_API_TOKEN is configured and registration is automatic. */
  automated: boolean;
};

const DOMAIN_STATUS: Record<
  SiteDomainDetail["status"],
  { label: string; variant: "success" | "info" | "warning" | "destructive" }
> = {
  live: { label: "Live", variant: "success" },
  dns_ok: { label: "DNS OK", variant: "info" },
  pending_dns: { label: "Awaiting DNS", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
};

const REQUEST_STATUS_OPTIONS: { value: DomainRequestStatus; label: string }[] = [
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In review" },
  { value: "awaiting_church", label: "Awaiting church" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
];

export function ChurchWebsitePanel({
  churchId,
  churchName,
  domains,
  requests,
  automated,
}: Props) {
  return (
    <div className="grid gap-4">
      <DomainsCard
        churchId={churchId}
        domains={domains}
        automated={automated}
      />
      <RequestsCard churchName={churchName} requests={requests} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOMAINS
// ---------------------------------------------------------------------------

function DomainsCard({
  churchId,
  domains,
  automated,
}: {
  churchId: string;
  domains: SiteDomainDetail[];
  automated: boolean;
}) {
  const [hostname, setHostname] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? "That didn't work.");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Domains</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {automated
              ? "Hostnames are registered with the hosting provider automatically. A domain goes live once the provider confirms it is serving."
              : "Automation is off (no VERCEL_API_TOKEN). Add the hostname to the Vercel project by hand, then mark it live here."}
          </p>
        </div>
        <Badge variant={automated ? "success" : "warning"}>
          {automated ? "Automated" : "Manual"}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No domain attached. This church is reachable on its FaithForm
            subdomain only.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {domains.map((domain) => {
              const status = DOMAIN_STATUS[domain.status];
              return (
                <li
                  key={domain.id}
                  className="flex flex-col gap-2 rounded-xl border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <a
                        href={`https://${domain.hostname}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-sm hover:underline"
                      >
                        {domain.hostname}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                      {domain.isPrimary ? (
                        <Badge variant="muted">Primary</Badge>
                      ) : null}
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={pending}
                        onClick={() =>
                          run(() => recheckDomain(domain.id), "Re-checked.")
                        }
                      >
                        <RefreshCw className="size-3.5" aria-hidden />
                        Re-check
                      </Button>

                      {domain.status !== "live" ? (
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => markDomainLive(domain.id),
                              `${domain.hostname} is live.`,
                            )
                          }
                        >
                          Mark live
                        </Button>
                      ) : null}

                      {!domain.isPrimary ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setPrimaryDomain(domain.id),
                              "Primary domain updated.",
                            )
                          }
                        >
                          <Star className="size-3.5" aria-hidden />
                          Primary
                        </Button>
                      ) : null}

                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Detach ${domain.hostname}? The site stops answering on it immediately.`,
                            )
                          ) {
                            return;
                          }
                          run(
                            () => removeChurchDomain(domain.id),
                            `${domain.hostname} detached.`,
                          );
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {domain.dnsDetail ?? "Not checked yet."}
                    {domain.dnsCheckedAt
                      ? ` · Checked ${formatDateTime(domain.dnsCheckedAt)}`
                      : ""}
                    {` · via ${domain.provider}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="admin-add-domain">Attach a hostname</Label>
            <Input
              id="admin-add-domain"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="gracechurch.org"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5"
            />
          </div>
          <Button
            disabled={pending || !hostname.trim()}
            onClick={() =>
              run(async () => {
                const result = await addChurchDomain({ churchId, hostname });
                if (result.ok) setHostname("");
                return result;
              }, "Domain attached.")
            }
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Attach
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// REQUESTS
// ---------------------------------------------------------------------------

function RequestsCard({
  churchName,
  requests,
}: {
  churchName: string;
  requests: SiteDomainRequest[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Domain requests</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          What {churchName} has asked for. Notes you save here are shown to them
          on their Website → Domain tab, so write them to be read.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests.</p>
        ) : (
          requests.map((request) => (
            <RequestRow key={request.id} request={request} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RequestRow({ request }: { request: SiteDomainRequest }) {
  const [status, setStatus] = useState<DomainRequestStatus>(request.status);
  const [notes, setNotes] = useState(request.adminNotes ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const dirty = status !== request.status || notes !== (request.adminNotes ?? "");

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              {request.kind === "register_new" ? "Needs a domain" : "Has a domain"}
            </Badge>
            <span className="font-mono text-sm">
              {request.hostname ?? "No name given"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Requested {formatDateTime(request.createdAt)}
            {request.handledAt ? ` · Closed ${formatDateTime(request.handledAt)}` : ""}
          </p>
        </div>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {request.alternateHostnames.length > 0 ? (
          <Field label="Alternatives" value={request.alternateHostnames.join(", ")} />
        ) : null}
        {request.registrar ? (
          <Field label="Registrar" value={request.registrar} />
        ) : null}
        {request.contactName ? (
          <Field label="Contact" value={request.contactName} />
        ) : null}
        {request.contactEmail ? (
          <Field label="Email" value={request.contactEmail} />
        ) : null}
        {request.contactPhone ? (
          <Field label="Phone" value={request.contactPhone} />
        ) : null}
      </dl>

      {request.notes ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            From the church
          </div>
          <p className="mt-1 whitespace-pre-line text-sm">{request.notes}</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <div>
          <Label htmlFor={`status-${request.id}`}>Status</Label>
          <Select
            id={`status-${request.id}`}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as DomainRequestStatus)
            }
            className="mt-1.5"
          >
            {REQUEST_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`notes-${request.id}`}>Note to the church</Label>
          <Textarea
            id={`notes-${request.id}`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="gracechurch.org was taken — we've secured gracechurchlou.org instead."
            className="mt-1.5"
          />
        </div>
      </div>

      <div>
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () => {
              const result = await updateDomainRequest({
                requestId: request.id,
                status,
                adminNotes: notes,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Request updated.");
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
