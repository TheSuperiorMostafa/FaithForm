import type { ReactNode } from "react";

import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { getGivePageUrl } from "@/lib/site-url";
import { formatUsPhoneDisplay, toE164 } from "@/lib/sms/phone";
import { cn } from "@/lib/utils";
import type {
  ContactBandContent,
  ContactBandItem,
  SiteProfile,
  SiteSocialLink,
  SiteSocialNetwork,
} from "@/types/site";

import { surfaceClass } from "../primitives";

/**
 * Email · Call · Give, with the church's social links under the phone number.
 *
 * It sits directly above the footer's map, so a visitor who scrolled to the
 * bottom looking for a way to reach the church finds all of them in one row.
 *
 * Every value comes from the church profile (Website → Details). A column the
 * church has nothing for is left out rather than drawn empty, and with nothing
 * at all the section renders nothing.
 */

// ---------------------------------------------------------------------------
// ICONS
// ---------------------------------------------------------------------------
// Inline rather than an icon package: site sections ship no icon library, and
// five brand marks plus three glyphs do not justify adding one to every church
// page. All of them fill with currentColor, so a format recolours them with
// `color` alone.

function Glyph({ children, evenOdd = false }: { children: ReactNode; evenOdd?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="currentColor"
      fillRule={evenOdd ? "evenodd" : undefined}
      clipRule={evenOdd ? "evenodd" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function EmailIcon() {
  return (
    <Glyph>
      <path d="M4 4h16a2 2 0 0 1 1.6.8L12 11.2 2.4 4.8A2 2 0 0 1 4 4z" />
      <path d="M2 6.8l10 6.7 10-6.7V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    </Glyph>
  );
}

function CallIcon() {
  return (
    <Glyph>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </Glyph>
  );
}

function GiveIcon() {
  return (
    <Glyph evenOdd>
      <path d="M4 5h16a2 2 0 0 1 2 2v1H2V7a2 2 0 0 1 2-2z" />
      <path d="M2 10.5h20V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM5 14.25h5.5v1.75H5z" />
    </Glyph>
  );
}

const SOCIAL_ICONS: Record<SiteSocialNetwork, () => ReactNode> = {
  facebook: () => (
    <Glyph>
      <path d="M13.5 22v-8.5h3.1l.5-3.6h-3.6V7.9c0-1 .3-1.7 1.8-1.7H17V3.1A25 25 0 0 0 14.6 3C12 3 10 4.6 10 7.5v2.4H7v3.6h3V22z" />
    </Glyph>
  ),
  instagram: () => (
    <Glyph evenOdd>
      <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.3-3.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z" />
    </Glyph>
  ),
  youtube: () => (
    <Glyph evenOdd>
      <path d="M6 4.8h12A4.5 4.5 0 0 1 22.5 9.3v5.4a4.5 4.5 0 0 1-4.5 4.5H6a4.5 4.5 0 0 1-4.5-4.5V9.3A4.5 4.5 0 0 1 6 4.8zM10 8.6v6.8l5.8-3.4z" />
    </Glyph>
  ),
  tiktok: () => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.5 3.5v11a4 4 0 1 1-4-4" />
      <path d="M13.5 3.5c.4 2.9 2.4 4.8 5.5 5" />
    </svg>
  ),
  x: () => (
    <Glyph evenOdd>
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.6l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z" />
    </Glyph>
  ),
};

// ---------------------------------------------------------------------------
// DERIVE
// ---------------------------------------------------------------------------

const SOCIAL_SOURCES: {
  network: SiteSocialNetwork;
  label: string;
  url: (profile: SiteProfile) => string | null;
}[] = [
  { network: "facebook", label: "Facebook", url: (p) => p.facebookUrl },
  { network: "instagram", label: "Instagram", url: (p) => p.instagramUrl },
  { network: "youtube", label: "YouTube", url: (p) => p.youtubeUrl },
  { network: "tiktok", label: "TikTok", url: (p) => p.tiktokUrl },
  { network: "x", label: "X", url: (p) => p.xUrl },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A profile link as something safe to put in an href, or null.
 *
 * Social links were typed by hand, some of them before anything checked them.
 * A bare "facebook.com/grace" gets https:// in front instead of becoming a
 * link relative to the church's own site, and anything that is not a web
 * address at all (an "@handle", a `javascript:` URL) is left off the page.
 */
export function webUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const candidate = /^https?:\/\//i.test(value)
    ? value
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+(?:[/?#]|$)/i.test(value)
      ? `https://${value}`
      : null;
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && url.hostname.includes(".") ? candidate : null;
  } catch {
    return null;
  }
}

function emailItem(raw: string | null): Partial<ContactBandItem> | null {
  const address = raw?.trim();
  if (!address || !EMAIL_PATTERN.test(address)) return null;
  return { text: address, href: `mailto:${address}` };
}

/**
 * Shown as 502-555-0134, dialled as +15025550134. An extension is kept in the
 * text but left out of the tel: link, where its digits would dial a different
 * number; a number too short to dial gets no column at all.
 */
function callItem(raw: string | null): Partial<ContactBandItem> | null {
  const text = formatUsPhoneDisplay(raw)?.trim();
  if (!raw || !text) return null;

  const main = raw.replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, "");
  const dial = toE164(main) ?? main.replace(/[^\d+]/g, "");
  if (dial.replace(/\D/g, "").length < 7) return null;

  return { text, href: `tel:${dial}` };
}

function socialLinks(profile: SiteProfile): SiteSocialLink[] {
  return SOCIAL_SOURCES.flatMap(({ network, label, url }) => {
    const href = webUrl(url(profile));
    return href ? [{ network, label, href }] : [];
  });
}

// ---------------------------------------------------------------------------
// VIEW
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: "email", Icon: EmailIcon },
  { key: "call", Icon: CallIcon },
  { key: "give", Icon: GiveIcon },
] as const;

function hasLink(item: ContactBandItem | null | undefined): item is ContactBandItem & {
  text: string;
  href: string;
} {
  return Boolean(item?.href?.trim() && item.text?.trim());
}

function SocialLinks({ links }: { links: SiteSocialLink[] }) {
  return (
    <ul className="contact-band__socials" aria-label="Social media">
      {links.map((link) => {
        const Icon = SOCIAL_ICONS[link.network];
        return (
          <li key={link.network}>
            <a
              href={link.href}
              className="contact-band__social"
              aria-label={link.label}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function ContactBand({ content, ctx }: SectionComponentProps<ContactBandContent>) {
  const columns = COLUMNS.filter(({ key }) => hasLink(content[key]));

  // Re-checked here as well as in derive: the socials can also arrive through a
  // hand-written override, which nothing else validates.
  const socials = (Array.isArray(content.socials) ? content.socials : []).flatMap((link) => {
    const href = webUrl(link?.href);
    const drawable = href && Object.hasOwn(SOCIAL_ICONS, link.network);
    return drawable ? [{ ...link, href }] : [];
  });

  if (columns.length === 0 && socials.length === 0) return null;

  const socialRow = socials.length > 0 ? <SocialLinks links={socials} /> : null;
  const socialsUnderCall = columns.some(({ key }) => key === "call");

  return (
    <section
      id={ctx.anchor}
      className={cn(surfaceClass(content.surface), "site-section", "contact-band")}
      aria-label="Contact"
    >
      {columns.length > 0 ? (
        <div className="contact-band__inner">
          {columns.map(({ key, Icon }) => {
            const item = content[key];
            return (
              <div key={key} className={`contact-band__item contact-band__item--${key}`}>
                <span className="contact-band__icon">
                  <Icon />
                </span>
                {item.label?.trim() ? (
                  <div className="contact-band__label">{item.label}</div>
                ) : null}
                <a href={item.href ?? undefined} className="contact-band__value">
                  {item.text}
                </a>
                {key === "call" ? socialRow : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* No phone number to sit under: the social links get a row of their own. */}
      {socialsUnderCall ? null : socialRow}
    </section>
  );
}

export const contactBandSection = defineSection<ContactBandContent>({
  type: "contact_band",
  label: "Contact info",
  fields: [
    {
      key: "email",
      label: "Email",
      type: "group",
      help: "The address itself comes from Website → Look & details.",
      fields: [{ key: "label", label: "Heading", type: "text" }],
    },
    {
      key: "call",
      label: "Call",
      type: "group",
      help: "The phone number and the social links under it come from Website → Look & details.",
      fields: [{ key: "label", label: "Heading", type: "text" }],
    },
    {
      key: "give",
      label: "Give",
      type: "group",
      help: "Appears once online giving is set up.",
      fields: [
        { key: "label", label: "Heading", type: "text" },
        { key: "text", label: "Link text", type: "text" },
      ],
    },
  ],
  defaults: {
    email: { label: "Email", text: null, href: null },
    call: { label: "Call", text: null, href: null },
    give: { label: "Give", text: "Give online", href: null },
    socials: [],
    surface: "ink",
  },
  derive: (profile) => {
    const email = emailItem(profile.email);
    const call = callItem(profile.phone);
    const socials = socialLinks(profile);

    return {
      ...(email ? { email } : {}),
      ...(call ? { call } : {}),
      // An absolute URL: on a church's own domain a relative /give/<slug> is
      // rewritten into its site and lands on a 404.
      ...(profile.givingEnabled && profile.slug
        ? { give: { href: getGivePageUrl(profile.slug) } }
        : {}),
      ...(socials.length > 0 ? { socials } : {}),
    };
  },
  Component: ContactBand,
});
