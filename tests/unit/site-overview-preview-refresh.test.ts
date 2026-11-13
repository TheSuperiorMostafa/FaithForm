import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

type Element = { type: unknown; key: string | null; props: Record<string, unknown> };
function findElement(node: unknown, type: unknown): Element | undefined {
  if (Array.isArray(node)) return node.map(child => findElement(child, type)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return element.type === type ? element : findElement(element.props.children, type);
}
function compile(relative: string, providers: Record<string, unknown>) {
  const path = resolve(relative);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const localRequire = createRequire(path), compiled = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)(
    (name: string) => providers[name] ?? localRequire(name), compiled, compiled.exports,
  );
  return compiled.exports;
}

// Execute the actual server page; only its I/O and child UI boundaries are
// substituted. The resulting SitePreview props are fed to its real hook logic.
function overview() {
  const site = {
    slug: "qa-church", page: { status: "draft" }, pages: [{ path: "/" }],
    sections: [{ type: "hero", isVisible: true }],
    settings: { layoutMode: "landing", isPublished: false, brandTokens: {} as Record<string, string>, customCss: null },
    theme: { key: "grace", name: "Grace", tokens: {}, sectionDefaults: {} },
  };
  let messages = 0;
  const Preview = () => null, Placeholder = () => null;
  const providers: Record<string, unknown> = {
    "@/lib/features/page-gate": { pageFeatureBlocked: async () => false },
    "@/lib/auth/church": { getChurchAuth: async () => ({ churchId: "qa-church", isAdmin: true }) },
    "@/lib/sites/queries": { getWebsiteForChurch: async () => site, countNewSubmissions: async () => messages },
    "@/lib/sites/domain-queries": { getChurchDomains: async () => [] },
    "@/lib/sites/domains": { getDomainProvider: () => ({ automated: false }) },
    "@/lib/site-url": { getCanonicalSiteUrl: () => "https://app.faithform.test" },
    "@/components/website-admin/site-preview": { SitePreview: Preview },
  };
  for (const [path, names] of [
    ["@/components/ui/action-card", ["ActionCard", "ActionGrid"]],
    ["@/components/ui/button", ["Button"]], ["@/components/ui/status-badge", ["StatusBadge"]],
    ["@/components/website-admin/empty-site", ["EmptySite"]],
    ["@/components/website-admin/layout-mode-card", ["LayoutModeCard"]],
    ["@/components/website-admin/publish-card", ["PublishCard"]],
  ] as const) providers[path] = Object.fromEntries(names.map(name => [name, Placeholder]));
  const render = compile("app/dashboard/website/page.tsx", providers).default as () => Promise<unknown>;
  return { site, setMessages(value: number) { messages = value; }, async props() {
    const preview = findElement(await render(), Preview);
    assert.ok(preview, "Overview must render the saved website preview");
    return preview.props;
  } };
}

function previewHarness() {
  type Effect = { deps?: unknown[]; cleanup?: () => void; run: () => void | (() => void) };
  const cells: unknown[] = [], effects: Effect[] = [], scheduled: number[] = [];
  let cursor = 0;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++; cells[index] ??= { value: initial };
      const cell = cells[index] as { value: unknown };
      return [cell.value, (value: unknown) => { cell.value = typeof value === "function" ? value(cell.value) : value; }];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++, previous = cells[index] as { callback: unknown; deps: unknown[] } | undefined;
      if (!previous || !same(previous.deps, deps)) cells[index] = { callback, deps };
      return (cells[index] as { callback: unknown }).callback;
    },
    useEffect(run: Effect["run"], deps?: unknown[]) {
      const index = cursor++, previous = effects[index];
      if (!previous || !same(previous.deps, deps)) {
        previous?.cleanup?.(); effects[index] = { run, deps }; scheduled.push(index);
      }
    },
  };
  const renderPreview = compile("components/website-admin/site-preview.tsx", { react }).SitePreview as (props: Record<string, unknown>) => unknown;
  return {
    render(props: Record<string, unknown>) {
      cursor = 0; const tree = renderPreview(props);
      for (const index of scheduled.splice(0)) {
        const cleanup = effects[index].run(); effects[index].cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      return findElement(tree, "iframe")!;
    },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}

test("Overview saved layout changes reload the existing preview at its unchanged URL", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = overview(), preview = previewHarness(); t.after(() => preview.unmount());
  const original = await page.props();
  assert.equal(typeof original.refreshToken, "string");
  const before = preview.render(original);
  assert.equal(preview.render(await page.props()).key, before.key, "identical server data must not reload the iframe");
  page.site.settings.layoutMode = "website"; page.site.pages = [{ path: "/" }, { path: "/about" }];
  const saved = await page.props();
  assert.equal(saved.previewUrl, original.previewUrl);
  assert.notEqual(saved.refreshToken, original.refreshToken);
  preview.render(saved);
  assert.notEqual(preview.render(saved).key, before.key, "the actual SitePreview refresh effect must remount its iframe");
});

test("Overview refresh token tracks saved publication and design but ignores inbox changes", async () => {
  const page = overview();
  const initial = (await page.props()).refreshToken;
  page.setMessages(7); assert.equal((await page.props()).refreshToken, initial);
  page.site.settings.isPublished = true; page.site.page.status = "published";
  const published = (await page.props()).refreshToken; assert.notEqual(published, initial);
  page.site.theme.key = "light";
  const theme = (await page.props()).refreshToken; assert.notEqual(theme, published);
  page.site.settings.brandTokens = { "--site-accent": "#123456" };
  assert.notEqual((await page.props()).refreshToken, theme);
});
