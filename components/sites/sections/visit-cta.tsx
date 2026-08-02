import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import type { VisitCtaContent } from "@/types/site";

import { Action, Eyebrow, Headline, SectionShell } from "../primitives";
import { ContactForm } from "./contact-form";

/**
 * "Plan your visit" plus the contact form.
 *
 * The form lives inside the same white panel as the what-to-know facts rather
 * than in a section of its own: a visitor reads what to expect and then acts,
 * and splitting those apart puts a page fold between the question and the
 * answer. The left CTA scrolls down to it.
 */
function VisitCta({ content, ctx }: SectionComponentProps<VisitCtaContent>) {
  const formAnchor = `${ctx.anchor}-form`;

  const action = content.action
    ? { ...content.action, href: content.action.href || `#${formAnchor}` }
    : null;

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <div className="site-split">
        <div>
          <Eyebrow>{content.eyebrow}</Eyebrow>
          <Headline headline={content.headline} className="site-display-lg" />
          {content.body ? <p className="site-lede">{content.body}</p> : null}
          <Action action={action} className="site-btn-solid" />
        </div>

        <div className="site-panel" id={formAnchor}>
          {content.facts.length > 0 ? (
            <>
              <div className="site-panel-title">{content.panelHeading}</div>
              {content.facts.map((fact, index) => (
                <div key={index} className="site-fact">
                  <div className="site-fact-icon" aria-hidden="true">
                    {fact.icon}
                  </div>
                  <div>
                    <div className="site-fact-title">{fact.title}</div>
                    <div className="site-fact-body">{fact.body}</div>
                  </div>
                </div>
              ))}
            </>
          ) : null}

          {content.form.enabled ? <ContactForm config={content.form} /> : null}
        </div>
      </div>
    </SectionShell>
  );
}

export const visitCtaSection = defineSection<VisitCtaContent>({
  type: "visit_cta",
  defaults: {
    eyebrow: null,
    headline: { lead: "Know what to expect before you walk in." },
    body: null,
    action: { label: "Plan your visit →", href: "", variant: "solid" },
    panelHeading: "What to know",
    facts: [],
    form: {
      enabled: true,
      endpoint: "/api/sites/contact",
      heading: "Tell us you're coming",
      description:
        "Send a note and someone from the team will look out for you on Sunday.",
      submitLabel: "Send it →",
      successMessage:
        "Thank you — we've got your note and someone will be in touch shortly.",
      showPhone: true,
      showMessage: true,
      consentNote: null,
    },
    surface: "accent",
  },
  derive: (profile) => ({
    form: { endpoint: `/api/sites/contact?site=${encodeURIComponent(profile.slug)}` },
  }),
  Component: VisitCta,
});
