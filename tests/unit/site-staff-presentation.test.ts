import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { staffGridSection } from "@/components/sites/sections/staff-grid";
import type { StaffGridContent } from "@/types/site";

Object.assign(globalThis, { React });
const ctx = { id: "staff", anchor: "staff", index: 0 };

function renderStaff(members: StaffGridContent["members"]) {
  return renderToStaticMarkup(createElement(staffGridSection.Component, {
    content: { ...staffGridSection.defaults, members }, ctx,
  }));
}

test("mixed staff photos preserve every supplied word without reserving a large empty portrait", () => {
  const members = [
    { name: "Avery Brooks", role: "Pastor", bio: "The first existing biography.", photo: { src: "https://example.test/avery.jpg", alt: "Avery at church" } },
    { name: "Cole Phillips", role: "Associate Pastor", bio: "The second existing biography.", photo: { src: null, alt: "Cole Phillips", placeholder: "portrait" } },
    { name: "Jordan Lee", role: "Worship Leader", bio: "The third existing biography.", photo: { src: "https://example.test/jordan.jpg", alt: "Jordan Lee" } },
  ];
  const before = JSON.stringify(members);
  const html = renderStaff(members);
  const cards = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];

  assert.equal(cards.length, 3);
  for (const [index, member] of members.entries()) {
    assert.match(cards[index], new RegExp(`<h3 class="site-staff-name">${member.name}</h3>`));
    assert.ok(cards[index].includes(member.role));
    assert.ok(cards[index].includes(member.bio));
  }
  assert.match(cards[1], /site-staff-card--text-only/);
  assert.match(cards[1], /<span class="site-staff-initials" aria-hidden="true">CP<\/span>/);
  assert.doesNotMatch(cards[1], /site-staff-photo|site-ph|<img\b|role="img"/);
  assert.match(cards[0], /<div class="site-staff-photo"><img[^>]*src="https:\/\/example.test\/avery.jpg"[^>]*alt="Avery at church"[^>]*class="site-media"[^>]*loading="lazy"/);
  assert.match(cards[2], /<img[^>]*src="https:\/\/example.test\/jordan.jpg"/);
  assert.equal(JSON.stringify(members), before, "presentation must not change any saved staff content");
});

test("absent, empty and whitespace photo URLs use compact identities without fabricated people or image labels", () => {
  for (const photo of [null, { src: null, alt: "" }, { src: "", alt: "" }, { src: "   ", alt: "" }]) {
    const html = renderStaff([{ name: "Élodie D’Arc", role: "", bio: "", photo }]);
    assert.match(html, /<h3 class="site-staff-name">Élodie D’Arc<\/h3>/);
    assert.match(html, /<span class="site-staff-initials" aria-hidden="true">ÉD<\/span>/);
    assert.doesNotMatch(html, /site-staff-photo|site-ph|<img\b|role="img"|Photo unavailable|portrait|site-staff-role|site-staff-bio/);
  }
});

test("single or blank names remain unchanged and do not invent missing identity information", () => {
  const single = renderStaff([{ name: "Cole", role: "", bio: "", photo: null }]);
  assert.match(single, /<span class="site-staff-initials" aria-hidden="true">C<\/span>/);
  const blank = renderStaff([{ name: "", role: "", bio: "", photo: null }]);
  assert.match(blank, /<h3 class="site-staff-name"><\/h3>/);
  assert.doesNotMatch(blank, /site-staff-initials|Unknown|Staff member|Photo unavailable|<img\b/);
});

test("an empty staff list stays hidden", () => {
  assert.equal(renderStaff([]), "");
});
