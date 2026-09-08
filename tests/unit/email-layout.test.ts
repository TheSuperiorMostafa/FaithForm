import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { renderEmail, type EmailDocument } from "@/lib/email/layout";

const doc: EmailDocument = {
  title: "Test",
  preheader: "The line the inbox shows",
  heading: "A heading",
  blocks: [
    { kind: "paragraph", text: "A paragraph." },
    { kind: "button", label: "Do the thing", url: "https://faithform.io/go" },
    { kind: "detail", label: "Amount", value: "$25.00" },
    { kind: "callout", title: "Credentials", rows: [{ label: "Code", value: "A1B2C3", mono: true }] },
    { kind: "list", items: ["One", "Two"] },
    { kind: "quote", text: "Someone else's words" },
    { kind: "muted", text: "Small print" },
  ],
};

test("renders an html part and a text part from one description", () => {
  const { html, text } = renderEmail(doc);
  assert.ok(html.includes("<!DOCTYPE html"));
  assert.ok(text.length > 0);
  assert.ok(!text.includes("<"), "the text part must not contain markup");
});

test("every block reaches both parts", () => {
  const { html, text } = renderEmail(doc);
  for (const needle of ["A paragraph.", "Do the thing", "$25.00", "A1B2C3", "One", "Small print"]) {
    assert.ok(html.includes(needle), `html is missing ${needle}`);
    assert.ok(text.includes(needle), `text is missing ${needle}`);
  }
  assert.ok(text.includes("https://faithform.io/go"), "the text part needs the raw URL");
});

/**
 * Without a preheader the client scrapes the first text it finds, which in a
 * logo-first layout is whatever sits nearest the top of the document.
 */
test("the preheader is present and hidden", () => {
  const { html } = renderEmail(doc);
  assert.ok(html.includes("The line the inbox shows"));
  const index = html.indexOf("The line the inbox shows");
  const container = html.slice(Math.max(0, index - 260), index);
  assert.match(container, /display:none/);
  assert.match(container, /mso-hide:all/);
});

test("content is escaped, so a church name cannot inject markup", () => {
  const { html } = renderEmail({
    ...doc,
    heading: '<script>alert(1)</script>',
    blocks: [{ kind: "paragraph", text: 'Bob & "Sons" <b>' }],
  });
  assert.ok(!html.includes("<script>"), "raw script tag reached the output");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

/** Word's renderer drops padding on an anchor, collapsing the button to a link. */
test("the button carries its Outlook fallback", () => {
  const { html } = renderEmail(doc);
  assert.match(html, /<!--\[if mso\]>/);
  assert.match(html, /v:roundrect/);
  assert.match(html, /<!\[endif\]-->/);
});

test("the layout is table-based, not flex or grid", () => {
  const { html } = renderEmail(doc);
  assert.ok(!/display:\s*(flex|grid)/.test(html), "no flex or grid in email HTML");
  assert.match(html, /role="presentation"/);
});

test("images carry explicit dimensions and empty alt on decoration", () => {
  const { html } = renderEmail(doc);
  const img = html.slice(html.indexOf("<img"), html.indexOf("<img") + 220);
  assert.match(img, /width="44"/);
  assert.match(img, /height="44"/);
  assert.match(img, /alt=""/);
  assert.match(img, /^<img src="https?:\/\//, "the logo src must be absolute");
});

test("a church brand replaces our colours and wordmark", () => {
  const { html } = renderEmail({
    ...doc,
    brand: {
      name: "Grace Community",
      primary: "#123456",
      accent: "#ABCDEF",
      logoUrl: null,
    },
  });
  assert.ok(html.includes("Grace Community"));
  assert.ok(html.includes("#123456"));
  assert.ok(html.includes("#ABCDEF"));
  assert.ok(!html.includes(">FaithForm<"), "the church's own mail must not be signed by us");
  assert.ok(!html.includes("<img"), "no logo means no broken image icon");
});

/**
 * A relative logo path has no origin to resolve against once the message is in
 * someone's inbox, so it must never reach the markup.
 */
test("a relative church logo is dropped rather than rendered", () => {
  const { html } = renderEmail({
    ...doc,
    brand: {
      name: "Grace",
      primary: "#123456",
      accent: "#ABCDEF",
      logoUrl: "/church-logos/grace.png",
    },
  });
  assert.ok(!html.includes("/church-logos/grace.png"));
});

/** The generated Supabase templates are the first email anyone ever sees. */
test("the generated Supabase templates are branded and keep their variables", () => {
  const dir = "docs/email/supabase";
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  assert.ok(files.length >= 6, "expected a template per Supabase auth email");

  for (const file of files) {
    const html = readFileSync(`${dir}/${file}`, "utf8");
    assert.match(html, /#002D5F/, `${file} lost the brand navy`);
    assert.match(html, /faithform-logo-96\.png/, `${file} lost the logo`);
    assert.ok(!html.includes("localhost"), `${file} was generated against localhost`);
    assert.ok(
      html.includes("{{ .ConfirmationURL }}") || html.includes("{{ .Token }}"),
      `${file} has no Supabase variable — its links would be dead`,
    );
  }
});
