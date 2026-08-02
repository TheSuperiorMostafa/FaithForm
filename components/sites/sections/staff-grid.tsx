import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import type { StaffGridContent } from "@/types/site";

import { Media, SectionHead, SectionShell, gridStyle } from "../primitives";

function StaffGrid({ content, ctx }: SectionComponentProps<StaffGridContent>) {
  if (content.members.length === 0) return null;

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <SectionHead
        eyebrow={content.eyebrow}
        headline={content.headline}
        note={content.note}
        align={content.align}
      />
      <div
        className="site-grid"
        style={gridStyle(content.columns, content.members.length)}
      >
        {content.members.map((member, index) => (
          <article key={`${member.name}-${index}`} className="site-staff-card">
            <Media image={member.photo} className="site-staff-photo" />
            <div className="site-staff-text">
              <h3 className="site-staff-name">{member.name}</h3>
              {member.role ? <div className="site-staff-role">{member.role}</div> : null}
              {member.bio ? <p className="site-staff-bio">{member.bio}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

export const staffGridSection = defineSection<StaffGridContent>({
  type: "staff_grid",
  defaults: {
    eyebrow: null,
    headline: { lead: "Our team" },
    note: null,
    members: [],
    columns: 4,
    surface: "canvas-alt",
    align: "split",
  },
  // Only `is_public` staff reach here; the query filters them out upstream so
  // an internal-only contact can never be one override away from the web.
  derive: (profile) => {
    if (profile.staff.length === 0) return {};

    return {
      members: profile.staff.map((person) => ({
        name: person.name,
        role: person.title,
        bio: person.bio,
        photo: person.photoUrl
          ? { src: person.photoUrl, alt: person.name }
          : { src: null, alt: person.name, placeholder: "portrait" },
      })),
    };
  },
  Component: StaffGrid,
});
