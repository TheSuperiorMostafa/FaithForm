import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";
import type { CustomEmbedContent } from "@/types/site";

import { surfaceClass } from "../primitives";

/**
 * The escape hatch: a raw HTML slot for the genuine one-off that structured
 * overrides cannot express -- a denominational widget, a ticketing embed, a
 * campaign block that exists for six weeks.
 *
 * This renders UNSANITISED HTML on purpose; sanitising it would defeat the
 * point of an escape hatch. What keeps that safe is the write path, not this
 * component: migration 0042 blocks church admins from creating or converting a
 * section of this type, so the markup can only come from a platform admin
 * through the service-role client. That restriction has to hold when the
 * pastor-facing editor ships.
 */
function CustomEmbed({ content, ctx }: SectionComponentProps<CustomEmbedContent>) {
  if (!content.html?.trim()) return null;

  return (
    <section
      id={ctx.anchor}
      className={cn(
        surfaceClass(content.surface),
        content.contained && "site-section",
      )}
    >
      <div
        className="site-embed"
        dangerouslySetInnerHTML={{ __html: content.html }}
      />
    </section>
  );
}

export const customEmbedSection = defineSection<CustomEmbedContent>({
  type: "custom_embed",
  label: "Custom block",
  // No `fields` on purpose. This renders raw HTML, so it stays agency-managed:
  // the dashboard shows it as read-only and migration 0042 blocks church admins
  // from writing it at the database level too.
  defaults: {
    html: "",
    surface: "canvas",
    contained: true,
  },
  Component: CustomEmbed,
});
