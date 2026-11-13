"use client";

import { useState } from "react";

import type { SectionComponentProps } from "@/lib/sites/contract";
import type { GiveCtaContent } from "@/types/site";

import { Eyebrow, Headline, SectionShell } from "../primitives";

/**
 * View only; the master definition lives in the sibling server module. See the
 * note in sermon-feed.tsx for why the split is required.
 */
export function GiveCtaView({ content, ctx }: SectionComponentProps<GiveCtaContent>) {
  // -1 is the "Other" slot: no amount is carried over and the giving page opens
  // on its own default rather than a number the visitor never chose.
  const [selected, setSelected] = useState(0);

  const amount = selected >= 0 ? content.amounts[selected] : null;
  // Keep existing fund/campaign parameters and fragments when carrying a
  // selected amount into the church's giving page.
  let href = content.href;
  if (amount) {
    const hashAt = href.indexOf("#");
    const hash = hashAt < 0 ? "" : href.slice(hashAt);
    const destination = hashAt < 0 ? href : href.slice(0, hashAt);
    const queryAt = destination.indexOf("?");
    const path = queryAt < 0 ? destination : destination.slice(0, queryAt);
    const query = new URLSearchParams(queryAt < 0 ? "" : destination.slice(queryAt + 1));
    query.set("amount", String(amount));
    href = `${path}?${query}${hash}`;
  }
  const submitLabel = content.submitLabel?.trim() || "Give {amount}";
  const label = amount
    ? submitLabel.replace("{amount}", `$${amount}`)
    : submitLabel.replace("{amount}", "").trim();

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <div
        className="site-split"
        style={{ "--site-split": "1fr .9fr" } as React.CSSProperties}
      >
        <div>
          <Eyebrow>{content.eyebrow}</Eyebrow>
          <Headline headline={content.headline} className="site-display-lg" />
          {content.body ? <p className="site-lede">{content.body}</p> : null}
          {content.bullets.length > 0 ? (
            <div className="site-give-bullets">
              {content.bullets.map((bullet, index) => (
                <span key={index} className="site-give-bullet">
                  {bullet}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="site-panel site-panel-ink">
          <div className="site-panel-label">{content.panelHeading}</div>
          <div className="site-amounts">
            {content.amounts.map((value, index) => (
              <button
                key={value}
                type="button"
                className="site-amount"
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
              >
                ${value}
              </button>
            ))}
            <button
              type="button"
              className="site-amount"
              aria-pressed={selected === -1}
              onClick={() => setSelected(-1)}
            >
              {content.otherLabel?.trim() || "Other amount"}
            </button>
          </div>

          <a href={href} className="site-btn site-btn-solid site-give-submit">
            {label}
          </a>

          {content.note ? <div className="site-give-note">{content.note}</div> : null}
        </div>
      </div>
    </SectionShell>
  );
}
