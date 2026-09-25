import { getGivePageUrl } from "@/lib/site-url";
import { defineSection } from "@/lib/sites/contract";
import type { GiveCtaContent } from "@/types/site";

import { GiveCtaView } from "./give-cta-view";

export const giveCtaSection = defineSection<GiveCtaContent>({
  type: "give_cta",
  label: "Giving",
  fields: [
    { key: "eyebrow", label: "Small heading above", type: "text" },
    { key: "headline", label: "Headline", type: "headline" },
    { key: "body", label: "Intro paragraph", type: "textarea" },
    { key: "panelHeading", label: "Panel heading", type: "text" },
    {
      key: "submitLabel",
      label: "Button label",
      type: "text",
      help: "Use {amount} where the chosen amount should appear.",
    },
    { key: "note", label: "Small print", type: "textarea" },
  ],
  defaults: {
    eyebrow: null,
    headline: { lead: "Every gift makes room at the table." },
    body: null,
    bullets: ["Secure & encrypted", "One-time or recurring"],
    panelHeading: "Choose an amount",
    amounts: [10, 20, 30, 50, 100],
    otherLabel: "Other",
    href: "/give",
    submitLabel: "Give {amount} →",
    note: null,
    surface: "canvas",
  },
  derive: (profile) => ({
    // Absolute, because the giving page lives on the app's host. A relative
    // `/give/<slug>` is fine on /sites/<slug>, but on a church's subdomain or
    // own domain the tenant rewrite turns it into /sites/<slug>/give/<slug>,
    // which does not exist.
    href: getGivePageUrl(profile.slug),
    ...(profile.address
      ? {
          note: `Prefer to mail a check? ${[
            profile.address,
            profile.city,
            profile.state,
            profile.zip,
          ]
            .filter(Boolean)
            .join(", ")}`,
        }
      : {}),
  }),
  Component: GiveCtaView,
});
