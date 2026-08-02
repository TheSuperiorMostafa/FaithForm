import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import {
  buildMapDirectionsUrl,
  buildMapEmbedUrl,
  formatCityLine,
  formatServiceTime,
} from "@/lib/sites/format";
import { cn } from "@/lib/utils";
import type { FooterMapContent } from "@/types/site";

import { surfaceClass } from "../primitives";

function FooterMap({ content, ctx }: SectionComponentProps<FooterMapContent>) {
  return (
    <footer id={ctx.anchor} className={cn(surfaceClass(content.surface))}>
      <div className="site-footer-grid">
        <div className="site-footer-body">
          <div className="site-footer-brand">
            {content.logo?.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- church-supplied URL
              <img
                src={content.logo.src}
                alt=""
                className="site-footer-logo"
              />
            ) : null}
            <div>
              <div className="site-footer-title">{content.title}</div>
              {content.subtitle ? (
                <div className="site-footer-sub">{content.subtitle}</div>
              ) : null}
            </div>
          </div>

          {content.blurb ? <p className="site-footer-blurb">{content.blurb}</p> : null}

          {content.columns.length + content.extraColumns.length > 0 ? (
            <div className="site-footer-cols">
              {[...content.columns, ...content.extraColumns].map((column, index) => (
                <div key={index}>
                  <div className="site-footer-col-head">{column.heading}</div>
                  {column.lines?.length ? (
                    <div className="site-footer-lines">
                      {column.lines.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  ) : null}
                  {column.links?.length ? (
                    <div className="site-footer-links">
                      {column.links.map((link) => (
                        <a
                          key={link.href + link.label}
                          href={link.href}
                          className="site-link"
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="site-footer-legal">{content.copyright}</div>
        </div>

        {content.map ? (
          <div className="site-map">
            {content.map.embedUrl ? (
              <iframe
                title="Map"
                src={content.map.embedUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : null}
            {content.map.addressLine1 ? (
              <div className="site-map-card">
                <div className="site-map-title">{content.map.addressLine1}</div>
                {content.map.addressLine2 ? (
                  <div className="site-map-sub">{content.map.addressLine2}</div>
                ) : null}
                {content.map.directionsUrl ? (
                  <a
                    href={content.map.directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site-btn site-btn-quiet"
                  >
                    Get directions →
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </footer>
  );
}

export const footerMapSection = defineSection<FooterMapContent>({
  type: "footer_map",
  label: "Footer",
  fields: [
    { key: "title", label: "Site name", type: "text" },
    { key: "subtitle", label: "Sub-line", type: "text" },
    { key: "blurb", label: "Short blurb", type: "textarea" },
    {
      key: "extraColumns",
      label: "Link columns",
      type: "list",
      addLabel: "Add column",
      titleKey: "heading",
      help: "The service-times column is added automatically from Church Profile.",
      itemFields: [
        { key: "heading", label: "Heading", type: "text" },
        {
          key: "links",
          label: "Links",
          type: "list",
          addLabel: "Add link",
          titleKey: "label",
          itemFields: [
            { key: "label", label: "Label", type: "text" },
            { key: "href", label: "Link", type: "url" },
          ],
        },
      ],
    },
    { key: "copyright", label: "Copyright line", type: "text" },
  ],
  defaults: {
    logo: null,
    title: "",
    subtitle: null,
    blurb: null,
    columns: [],
    extraColumns: [],
    copyright: "",
    map: null,
    surface: "ink-strong",
  },
  derive: (profile) => {
    const cityLine = formatCityLine(profile.city, profile.state, profile.zip);
    const fullAddress = [profile.address, cityLine].filter(Boolean).join(", ");

    const gatherLines = profile.serviceTimes
      .map((time) => {
        const clock = formatServiceTime(time.startTime);
        return clock ? `${time.label} · ${clock}` : null;
      })
      .filter((line): line is string => Boolean(line));

    const columns: FooterMapContent["columns"] = [];
    if (gatherLines.length > 0) {
      columns.push({ heading: "Gather", lines: gatherLines });
    }

    return {
      title: profile.name,
      subtitle: profile.denomination,
      ...(profile.logoUrl ? { logo: { src: profile.logoUrl, alt: profile.name } } : {}),
      ...(profile.description ? { blurb: profile.description } : {}),
      ...(columns.length > 0 ? { columns } : {}),
      copyright: `© ${new Date().getFullYear()} ${profile.name}${
        fullAddress ? ` · ${fullAddress}` : ""
      }`,
      ...(fullAddress
        ? {
            map: {
              // A pasted share link wins over the generated query, since a
              // church that set one usually did it to fix a bad pin.
              embedUrl: profile.googleMapsUrl?.includes("output=embed")
                ? profile.googleMapsUrl
                : buildMapEmbedUrl(fullAddress),
              directionsUrl:
                profile.googleMapsUrl && !profile.googleMapsUrl.includes("output=embed")
                  ? profile.googleMapsUrl
                  : buildMapDirectionsUrl(fullAddress),
              addressLine1: profile.address,
              addressLine2: cityLine,
            },
          }
        : {}),
    };
  },
  Component: FooterMap,
});
