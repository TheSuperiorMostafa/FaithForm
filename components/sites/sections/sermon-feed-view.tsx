"use client";

import { useState } from "react";

import type { SectionComponentProps } from "@/lib/sites/contract";
import type { SermonFeedContent } from "@/types/site";

import { Media, SectionHead, SectionShell } from "../primitives";

/**
 * View only. The master definition lives in the sibling server module, because
 * everything exported from a "use client" file becomes a reference proxy on the
 * server -- the registry reading `.type` off it would throw at build time.
 */
export function SermonFeedView({ content, ctx }: SectionComponentProps<SermonFeedContent>) {
  const [selected, setSelected] = useState(0);

  const head = (
    <SectionHead
      eyebrow={content.eyebrow}
      headline={content.headline}
      link={content.link}
      align={content.align}
    />
  );

  if (content.items.length === 0) {
    return (
      <SectionShell surface={content.surface} anchor={ctx.anchor}>
        {head}
        <p className="site-empty">{content.emptyMessage}</p>
      </SectionShell>
    );
  }

  const featured = content.items[Math.min(selected, content.items.length - 1)];

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      {head}
      <div className="site-sermon-layout">
        <div>
          <div className="site-sermon-stage site-ph" data-ph="sermon still">
            {featured.thumbnail?.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- church-supplied URL
              <img
                src={featured.thumbnail.src}
                alt=""
                className="site-media"
                style={{ position: "absolute", inset: 0 }}
              />
            ) : null}
            {featured.videoUrl ? (
              <a
                className="site-play"
                href={featured.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Watch ${featured.title}`}
              />
            ) : (
              <span className="site-play" aria-hidden="true" />
            )}
          </div>

          <div className="site-sermon-meta">
            {featured.series ? (
              <span className="site-sermon-series">{featured.series}</span>
            ) : null}
            {featured.series && featured.date ? (
              <span className="site-sermon-dot" />
            ) : null}
            {featured.date ? (
              <span className="site-sermon-date">{featured.date}</span>
            ) : null}
          </div>
          <h3 className="site-sermon-title">{featured.title}</h3>
          {featured.speaker ? (
            <div className="site-sermon-speaker">{featured.speaker}</div>
          ) : null}
        </div>

        <div className="site-sermon-list">
          {content.items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="site-sermon-row"
              aria-current={index === selected}
              onClick={() => setSelected(index)}
            >
              <Media
                image={item.thumbnail ?? { src: null, alt: "", placeholder: "thumb" }}
                className="site-sermon-thumb"
              />
              <span style={{ minWidth: 0 }}>
                {item.series ? (
                  <span className="site-sermon-series" style={{ display: "block" }}>
                    {item.series}
                  </span>
                ) : null}
                <span className="site-sermon-row-title" style={{ display: "block" }}>
                  {item.title}
                </span>
                <span className="site-sermon-row-meta" style={{ display: "block" }}>
                  {[item.speaker, item.date].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
