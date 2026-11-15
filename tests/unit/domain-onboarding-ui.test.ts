import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement, type ComponentType } from "react";
Object.assign(globalThis, { React });
import { domainInstructionsText } from "@/components/website-admin/website-words";
import { DomainRequestsTable } from "@/components/admin/domain-requests-table";
import type { AdminSiteDomain } from "@/lib/sites/domain-queries";

const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
const { build } = tsxRequire("esbuild");
let workspace: Promise<ComponentType<Record<string, unknown>>> | undefined;
async function renderWorkspace(props: Record<string, unknown>) {
  workspace ??= (async () => {
    const entry = fileURLToPath(new URL("../../components/website-admin/domain-workspace.tsx", import.meta.url));
    const built = await build({
      entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
      plugins: [{ name: "domain-ui-providers", setup(builder: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { loader: string; contents: string }) => void }) {
        builder.onResolve({ filter: /^(?:next\/navigation|@\/app\/dashboard\/website\/domain-actions)$/ }, (args: { path: string }) => ({ path: args.path, namespace: "domain-ui" }));
        builder.onLoad({ filter: /.*/, namespace: "domain-ui" }, (args: { path: string }) => ({ loader: "js", contents: args.path === "next/navigation"
          ? 'export function useRouter(){return {refresh(){},push(){},replace(){}}}'
          : 'export async function recheckDomainDns(){throw new Error("read-only rendering must not check a domain")};export const cancelDomainRequest=recheckDomainDns,removeDomain=recheckDomainDns,submitDomainRequest=recheckDomainDns;' }));
      } }],
    });
    const mod = { exports: {} as { DomainWorkspace: ComponentType<Record<string, unknown>> } };
    new Function("require", "module", "exports", built.outputFiles[0].text)(require, mod, mod.exports);
    return mod.exports.DomainWorkspace;
  })();
  return renderToStaticMarkup(createElement(await workspace, props));
}
const domain: AdminSiteDomain = {
  id: "domain-1", churchId: "church-1", churchName: "Grace Church", churchSlug: "grace", hostname: "grace.org", isPrimary: true, status: "live", verifiedAt: "2026-11-15T10:00:00Z", dnsCheckedAt: "2026-11-15T10:00:00Z", dnsDetail: "Correct", provider: "vercel", providerDomainId: "grace.org", notes: null, createdAt: "2026-11-15T10:00:00Z",
};
const records = [{ type: "A" as const, name: "@", value: "76.76.21.21", note: "Connects the website." }];
const defaults = { domains: [{ ...domain, records }], openRequest: null, history: [], faithformAddress: null, previewUrl: "https://faithform.io/sites/grace?preview=1", canEdit: true, churchName: "Grace Church", defaults: { contactName: null, contactEmail: null }, automated: true };

test("connecting a domain does not present a draft as a public website", async () => {
  const html = await renderWorkspace({ ...defaults, publicUrl: "https://grace.org", isPublished: false });
  assert.match(html, /Not published/);
  assert.match(html, /Review and publish/);
  assert.match(html, /Preview links are for your signed-in team/);
  assert.doesNotMatch(html, /href="https:\/\/grace\.org"/);
  assert.doesNotMatch(html, /Visitors can reach your website/);
  assert.match(html, /href="https:\/\/faithform\.io\/sites\/grace\?preview=1"/);
});

test("a published root and its www redirect form one understandable setup card", async () => {
  const html = await renderWorkspace({ ...defaults, domains: [{ ...domain, records }, { ...domain, id: "alias", hostname: "www.grace.org", isPrimary: false, redirectTo: "grace.org", records: [] }], publicUrl: "https://grace.org", isPublished: true });
  assert.match(html, /href="https:\/\/grace\.org"/);
  assert.match(html, /Visit website/);
  assert.match(html, /Also connects www.grace\.org/);
  assert.equal((html.match(/<h3[^>]*>grace\.org<\/h3>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<h3[^>]*>www\.grace\.org<\/h3>/);
});

test("a working main address still shows its companion’s unfinished setup", async () => {
  const setup = { phase: "https", title: "Finish connecting all addresses", description: "www.grace.org is waiting for its secure connection.", checkedAt: null, nextCheckAt: null, records, verification: [], retryable: true };
  const html = await renderWorkspace({ ...defaults, domains: [{ ...domain, records, setup }, { ...domain, id: "alias", hostname: "www.grace.org", status: "pending_dns", isPrimary: false, redirectTo: "grace.org", records: [] }], publicUrl: "https://grace.org", isPublished: true });
  assert.match(html, /Finish connecting all addresses/);
  assert.match(html, /Both versions are checked before setup is complete/);
  assert.match(html, /Check again/);
  assert.doesNotMatch(html, /Also connects www/);
  assert.match(html, /href="https:\/\/grace\.org"/);
});

test("a published FaithForm fallback shows the complete church address", async () => {
  const html = await renderWorkspace({ ...defaults, domains: [], publicUrl: "https://faithform.io/sites/grace", isPublished: true });
  assert.match(html, /faithform\.io\/sites\/grace/);
  assert.match(html, /href="https:\/\/faithform\.io\/sites\/grace"/);
});

test("ownership setup carries the exact TXT challenge into visible controls and the IT draft", async () => {
  const verification = [{ type: "TXT", name: "_vercel.grace.org", value: "vc-domain-verify=church-owned", note: "Confirms that this address belongs to your church." }];
  const html = await renderWorkspace({ ...defaults, domains: [{ ...domain, status: "pending_dns", records, setup: { phase: "ownership", title: "Confirm ownership", description: "Your IT person needs to confirm this address.", checkedAt: null, nextCheckAt: null, records, verification, retryable: true } }], isPublished: false });
  assert.match(html, /Confirm ownership/);
  assert.match(html, /Copy instructions for our IT person/);
  assert.match(html, /vc-domain-verify=church-owned/);
  const mailto = html.match(/href="(mailto:[^"]+)"/)?.[1];
  assert.ok(mailto);
  const email = decodeURIComponent(mailto.replace(/&amp;/g, "&"));
  assert.match(email, /Type: TXT/);
  assert.match(email, /_vercel\.grace\.org/);
  assert.match(email, /vc-domain-verify=church-owned/);
  assert.match(email, /FaithForm checks in the background/);
  assert.doesNotMatch(html, /email you when/);
});

test("manual handoff does not promise automatic checks or delivery of an email", () => {
  const text = domainInstructionsText({ hostname: "grace.org", records, automatic: false });
  assert.match(text, /choose Check again/);
  assert.doesNotMatch(text, /checks automatically|checks in the background|email you/);
  assert.match(text, /Keep existing email \(MX\), email verification \(TXT\)/);
});

test("the admin queue names the blocker and exposes a labelled setup action", () => {
  const html = renderToStaticMarkup(createElement(DomainRequestsTable, { requests: [], domains: [{ ...domain, status: "pending_dns" }], filter: "open" }));
  assert.match(html, /Waiting for church/);
  assert.match(html, /church or its IT person needs to update/);
  assert.match(html, /Open setup/);
  assert.match(html, /href="\/admin\/churches\/church-1\?tab=website"/);
  assert.doesNotMatch(html, /<table/);
});


test("admin connection pagination retains the request filter and offers a first-page return", () => {
  const html = renderToStaticMarkup(createElement(DomainRequestsTable, { requests: [], domains: [], filter: "awaiting_church", currentDomainsCursor: "current|row", nextDomainsCursor: "2026-11-15T10:00:00Z|next-row" }));
  assert.match(html, /Connection counts for this page/);
  assert.match(html, /Older connections/);
  assert.match(html, /Newest connections/);
  assert.match(html, /href="\/admin\/domains\?filter=awaiting_church&amp;domainCursor=2026-11-15T10%3A00%3A00Z%7Cnext-row"/);
  assert.match(html, /href="\/admin\/domains\?filter=awaiting_church"/);
});
