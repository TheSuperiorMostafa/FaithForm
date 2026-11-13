import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import type { StaffGridContent } from "@/types/site";

import { Media, SectionHead, SectionShell, gridStyle } from "../primitives";

function staffInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return initials.map((part) => Array.from(part)[0]).join("").toUpperCase();
}

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
        {content.members.map((member, index) => {
          const hasPhoto = Boolean(member.photo?.src?.trim());
          const initials = hasPhoto ? "" : staffInitials(member.name);
          return (
            <article key={`${member.name}-${index}`} className={`site-staff-card${hasPhoto ? "" : " site-staff-card--text-only"}`}>
              {hasPhoto ? <Media image={member.photo} className="site-staff-photo" /> : null}
              <div className="site-staff-text">
                <div className="site-staff-identity">
                  {initials ? <span className="site-staff-initials" aria-hidden="true">{initials}</span> : null}
                  <div>
                    <h3 className="site-staff-name">{member.name}</h3>
                    {member.role ? <div className="site-staff-role">{member.role}</div> : null}
                  </div>
                </div>
                {member.bio ? <p className="site-staff-bio">{member.bio}</p> : null}
              </div>
            </article>
          );
        })}
      </div>
    </SectionShell>
  );
}

export const staffGridSection = defineSection<StaffGridContent>({
  type: "staff_grid",
  label: "Our team",
  fields: [
    { key: "eyebrow", label: "Small heading above", type: "text" },
    { key: "headline", label: "Headline", type: "headline" },
    { key: "note", label: "Side note", type: "textarea" },
    {
      key: "members",
      label: "People",
      type: "list",
      addLabel: "Add person",
      titleKey: "name",
      help: "Starts with the public team in Look & Details. Removing everyone hides these entries. Reset to original restores the shared team.",
      itemFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "role", label: "Role", type: "text" },
        { key: "bio", label: "Short bio", type: "textarea" },
        { key: "photo", label: "Photo", type: "image", aspect: "portrait" },
      ],
    },
  ],
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
