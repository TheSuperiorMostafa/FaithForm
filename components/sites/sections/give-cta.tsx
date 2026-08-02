import { defineSection } from "@/lib/sites/contract";
import type { GiveCtaContent } from "@/types/site";

import { GiveCtaView } from "./give-cta-view";

export const giveCtaSection = defineSection<GiveCtaContent>({
  type: "give_cta",
  label: "Giving",
  fields: [
    { key: "eyebrow", label: "Eyebrow", type: "text" },
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
    href: `/give/${profile.slug}`,
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
