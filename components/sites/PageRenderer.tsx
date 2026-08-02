import type { ResolvedPage } from "@/lib/sites/contract";
import { SECTION_REGISTRY } from "@/lib/sites/registry";

/**
 * Walks a resolved page and draws it.
 *
 * Tokens land as inline custom properties on the wrapper, which is what makes
 * every child render in this church's palette without any of them being told
 * whose palette it is. Same mechanism as [data-give-branded] on the giving
 * pages, one level larger.
 */
export function PageRenderer({ page }: { page: ResolvedPage }) {
  return (
    // The outer element carries the tokens too, so the letterboxing either side
    // of the 1280px column is the church's own ink rather than whatever the app
    // shell's <body> happens to be set to.
    <div className="site-page" style={page.tokens as React.CSSProperties}>
      <div data-site={page.slug}>
        {page.customCss ? (
          // Sanitised in lib/sites/resolve.ts. It can only ever load here, on
          // this church's own pages, which is what walls it off from the rest.
          <style dangerouslySetInnerHTML={{ __html: page.customCss }} />
        ) : null}

        {page.sections.map((section) => {
          const master = SECTION_REGISTRY[section.type];
          if (!master) return null;

          const { Component } = master;
          return (
            <Component
              key={section.ctx.id}
              content={section.content}
              ctx={section.ctx}
            />
          );
        })}
      </div>
    </div>
  );
}
