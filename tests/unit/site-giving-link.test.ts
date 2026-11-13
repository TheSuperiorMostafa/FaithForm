import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GiveCtaView } from "@/components/sites/sections/give-cta-view";
import { giveCtaSection } from "@/components/sites/sections/give-cta";
import type { GiveCtaContent } from "@/types/site";

Object.assign(globalThis, { React });

test("website giving retains existing campaign parameters and fragments when selecting an amount", () => {
  for (const [href, expected] of [
    ["https://give.example/church", "https://give.example/church?amount=10"],
    ["https://give.example/church?fund=missions#donate", "https://give.example/church?fund=missions&amp;amount=10#donate"],
    ["/give/grace?amount=50&fund=missions", "/give/grace?amount=10&amp;fund=missions"],
  ]) {
    const html = renderToStaticMarkup(createElement(GiveCtaView, {
      content: { ...giveCtaSection.defaults, href } as GiveCtaContent,
      ctx: { id: "giving", anchor: "give", index: 0 },
    }));
    assert.ok(html.includes(`href="${expected}"`), html);
  }
});
