import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VisitorInvitationsCard } from "@/components/settings/visitor-invitations-card";
import type { InvitationSummary } from "@/lib/faithform/invitations";
import ts from "typescript";

Object.assign(globalThis, { React });

test("a withdrawn invitation reports its withdrawal day instead of calling a future expiry expired", () => {
  const invitation: InvitationSummary = {
    id: "11111111-1111-4111-8111-111111111111", purpose: "join", invitedLabel: "QA invitation", invitedEmail: null,
    expiresAt: "2099-11-20T12:00:00Z", revokedAt: "2026-11-13T12:00:00Z", usedCount: 0, maxUses: 1,
  };
  const html = renderToStaticMarkup(React.createElement(VisitorInvitationsCard, { isAdmin: true, invitations: [invitation] }));
  assert.ok(html.includes("Withdrawn "));
  assert.ok(!html.includes("Expired "));
  assert.ok(!html.includes(">Withdraw</button>"));
});

type Element = { type: unknown; key?: string | null; props: Record<string, unknown> };
function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return predicate(element) ? element : find(element.props.children, predicate);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const older: InvitationSummary = { id: "older-invitation", purpose: "join", invitedLabel: "Older invitation", invitedEmail: null,
  expiresAt: "2099-11-20T12:00:00Z", revokedAt: null, usedCount: 0, maxUses: 1 };
const latest: InvitationSummary = { ...older, id: "latest-invitation", invitedLabel: "Latest invitation" };
const issuedUrl = "https://example.invalid/invitation/synthetic-qa-link";
type CreateResult = { ok: true; data: { id: string; url: string } } | { ok: false; message: string };
type WithdrawResult = { ok: true } | { ok: false; message: string };

/** Run the real component handlers; substitute only render scheduling and action I/O. */
function harness() {
  const path = resolve("components/settings/visitor-invitations-card.tsx"), localRequire = createRequire(path);
  const state = { create: deferred<CreateResult>(), withdraw: deferred<WithdrawResult>(),
    creates: [] as Record<string, unknown>[], withdrawals: [] as string[], errors: [] as string[], successes: [] as string[] };
  const props = { isAdmin: true, invitations: [{ ...older }] };
  const cells: unknown[] = [], work: Promise<unknown>[] = []; let cursor = 0;
  const react = {
    useState(initial: unknown) { const index = cursor++; cells[index] ??= { value: initial }; const cell = cells[index] as { value: unknown };
      return [cell.value, (value: unknown) => { cell.value = value; }]; },
    useTransition() { const index = cursor++; cells[index] ??= { pending: false }; const cell = cells[index] as { pending: boolean };
      return [cell.pending, (callback: () => unknown) => { cell.pending = true; work.push(Promise.resolve(callback()).finally(() => { cell.pending = false; })); }]; },
  };
  const providers: Record<string, unknown> = {
    react,
    sonner: { toast: { error(message: string) { state.errors.push(message); }, success(message: string) { state.successes.push(message); } } },
    "@/app/dashboard/settings/faithform-actions": {
      createVisitorInvitation: (input: Record<string, unknown>) => { state.creates.push(input); return state.create.promise; },
      withdrawVisitorInvitation: (id: string) => { state.withdrawals.push(id); return state.withdraw.promise; },
    },
  };
  const placeholders = new Proxy({}, { get: (_object, key) => String(key) });
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiled = { exports: {} as { VisitorInvitationsCard: (input: typeof props) => unknown } };
  new Function("require", "module", "exports", source)((name: string) => providers[name] ?? (name.startsWith("@/components/") ? placeholders : localRequire(name)), compiled, compiled.exports);
  const render = () => {
    cursor = 0; const tree = compiled.exports.VisitorInvitationsCard(props);
    const create = find(tree, element => element.type === "Button" && element.props.className === "self-start")!;
    return { create,
      clickCreate() { (create.props.onClick as () => void)(); },
      withdraw(id: string) { const row = find(tree, element => element.key === id)!; return find(row, element => element.type === "Button")!; },
      clickWithdraw(id: string) { const row = find(tree, element => element.key === id)!; (find(row, element => element.type === "Button")!.props.onClick as () => void)(); },
      url: find(tree, element => element.type === "code")?.props.children,
      copy: find(tree, element => element.type === "Button" && element.props.children === "Copy link"),
    };
  };
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { state, props, render, async finish() { await settle(); await Promise.all(work); }, async issue() {
    render().clickCreate(); state.create.resolve({ ok: true, data: { id: latest.id, url: issuedUrl } }); await settle(); await Promise.all(work);
    props.invitations.push({ ...latest });
  } };
}

test("creation and withdrawal show their own pending action and withdrawing the new invitation removes its copyable link", async () => {
  const h = harness(); h.render().clickCreate();
  assert.equal(h.render().create.props.children, "Creating…"); assert.equal(h.render().create.props.disabled, true);
  assert.equal(h.render().withdraw(older.id).props.children, "Withdraw"); assert.equal(h.render().withdraw(older.id).props.disabled, true);
  h.state.create.resolve({ ok: true, data: { id: latest.id, url: issuedUrl } }); await h.finish(); h.props.invitations.push({ ...latest });
  assert.equal(h.render().url, issuedUrl); assert.ok(h.render().copy);
  h.render().clickWithdraw(latest.id);
  assert.equal(h.render().create.props.children, "Create invitation link"); assert.equal(h.render().create.props.disabled, true);
  assert.equal(h.render().withdraw(latest.id).props.children, "Withdrawing…");
  h.state.withdraw.resolve({ ok: true }); await h.finish();
  assert.deepEqual(h.state.withdrawals, [latest.id]); assert.equal(h.render().url, undefined); assert.equal(h.render().copy, undefined);
  assert.equal(h.render().create.props.disabled, false); assert.ok(h.state.successes.includes("Invitation withdrawn."));
});

test("withdrawing an older invitation preserves the newly issued valid link", async () => {
  const h = harness(); await h.issue(); h.render().clickWithdraw(older.id);
  h.state.withdraw.resolve({ ok: true }); await h.finish();
  assert.deepEqual(h.state.withdrawals, [older.id]); assert.equal(h.render().url, issuedUrl); assert.ok(h.render().copy);
});

test("a failed withdrawal keeps the issued link and shows recovery; a successful retry clears it", async () => {
  const h = harness(); await h.issue(); h.render().clickWithdraw(latest.id);
  h.state.withdraw.resolve({ ok: false, message: "We couldn't withdraw this invitation. Try again." }); await h.finish();
  assert.equal(h.render().url, issuedUrl); assert.ok(h.render().copy); assert.equal(h.render().create.props.disabled, false);
  assert.match(h.state.errors[0], /Try again/); assert.ok(!h.state.successes.includes("Invitation withdrawn."));
  h.state.withdraw = deferred<WithdrawResult>(); h.render().clickWithdraw(latest.id); h.state.withdraw.resolve({ ok: true }); await h.finish();
  assert.equal(h.render().url, undefined); assert.equal(h.render().copy, undefined); assert.deepEqual(h.state.withdrawals, [latest.id, latest.id]);
});
