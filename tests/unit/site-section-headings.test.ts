import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionHead } from "@/components/sites/primitives";

Object.assign(globalThis, { React });

for (const align of ["split", "center"] as const) {
  test(`${align} section headers present repeated saved copy once without changing it`, () => {
    const content = {
      eyebrow: "  OUR   PASTOR  ",
      headline: { lead: "Our", accent: "Pastor" },
      note: "The church's existing note.",
      align,
    };
    const before = JSON.stringify(content);
    const html = renderToStaticMarkup(React.createElement(SectionHead, content));
    assert.doesNotMatch(html, /site-eyebrow/);
    assert.match(html, /<h2[^>]*>Our <span[^>]*>Pastor<\/span><\/h2>/);
    assert.match(html, /The church&#x27;s existing note\./);
    assert.equal(JSON.stringify(content), before);
  });
}

test("different headings and supporting information remain visible", () => {
  const html = renderToStaticMarkup(React.createElement(SectionHead, {
    eyebrow: "Our church",
    headline: { lead: "Our Pastor" },
    note: "An existing introduction.",
    align: "split",
  }));
  assert.match(html, /class="site-eyebrow">Our church<\/div>/);
  assert.match(html, /<h2[^>]*>Our Pastor<\/h2>/);
  assert.match(html, /An existing introduction\./);
});

test("an eyebrow remains when the editable headline has been cleared", () => {
  const html = renderToStaticMarkup(React.createElement(SectionHead, {
    eyebrow: "Our pastor",
    headline: { lead: "" },
    align: "split",
  }));
  assert.match(html, /Our pastor/);
  assert.doesNotMatch(html, /<h2/);
});
