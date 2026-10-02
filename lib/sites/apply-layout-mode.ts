import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildFooterExploreLinks,
  buildHeroActions,
  buildSiteNavLinks,
  buildVisitCta,
  rewriteKnownHrefs,
  sortSectionsForLanding,
  WEBSITE_PAGE_DEFS,
  type SiteLayoutMode,
} from "@/lib/sites/layout-mode";
import type { SiteProfile } from "@/types/site";

/**
 * Move sections between the home page and per-section pages when a church
 * switches Landing ↔ Website mode.
 *
 * Website mode keeps nav / hero / service times / contact / footer on `/` and
 * moves each content section onto its own path. Public subpage renders pull
 * chrome from home at request time, so we do not duplicate nav/footer rows.
 */

type SectionRow = {
  id: string;
  page_id: string;
  type: string;
  sort_order: number;
  is_visible: boolean;
  props: Record<string, unknown> | null;
};

type PageRow = {
  id: string;
  path: string;
  title: string | null;
  status: string;
};

export async function applySiteLayoutMode(args: {
  supabase: SupabaseClient;
  churchId: string;
  mode: SiteLayoutMode;
  profile: SiteProfile;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, churchId, mode, profile } = args;

  const { data: pagesData, error: pagesError } = await supabase
    .from("site_pages")
    .select("id, path, title, status")
    .eq("church_id", churchId);

  if (pagesError) {
    return { ok: false, error: pagesError.message };
  }

  const pages = (pagesData ?? []) as PageRow[];
  const home = pages.find((p) => p.path === "/");
  if (!home) {
    return { ok: false, error: "Your home page could not be found." };
  }

  const { data: sectionsData, error: sectionsError } = await supabase
    .from("site_sections")
    .select("id, page_id, type, sort_order, is_visible, props")
    .eq("church_id", churchId);

  if (sectionsError) {
    return { ok: false, error: sectionsError.message };
  }

  const sections = (sectionsData ?? []) as SectionRow[];

  if (mode === "website") {
    const result = await expandToWebsitePages({
      supabase,
      churchId,
      home,
      pages,
      sections,
      profile,
    });
    if (!result.ok) return result;
  } else {
    const result = await collapseToLandingPage({
      supabase,
      churchId,
      home,
      pages,
      sections,
      profile,
    });
    if (!result.ok) return result;
  }

  const { error: settingsError } = await supabase.from("site_settings").upsert(
    { church_id: churchId, layout_mode: mode },
    { onConflict: "church_id" },
  );

  if (settingsError) {
    return { ok: false, error: settingsError.message };
  }

  return { ok: true };
}

async function expandToWebsitePages(args: {
  supabase: SupabaseClient;
  churchId: string;
  home: PageRow;
  pages: PageRow[];
  sections: SectionRow[];
  profile: SiteProfile;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, churchId, home, pages, sections, profile } = args;
  const pagesByPath = new Map(pages.map((p) => [p.path, p]));

  // Ensure a page row exists for every content section type we still have.
  for (const def of WEBSITE_PAGE_DEFS) {
    const section = sections.find((s) => s.type === def.type);
    if (!section) continue;

    let page = pagesByPath.get(def.path);
    if (!page) {
      const { data: inserted, error } = await supabase
        .from("site_pages")
        .insert({
          church_id: churchId,
          path: def.path,
          title: def.title,
          status: home.status,
        })
        .select("id, path, title, status")
        .maybeSingle();

      if (error || !inserted) {
        return { ok: false, error: error?.message ?? "Could not create a page." };
      }
      page = inserted as PageRow;
      pagesByPath.set(def.path, page);
    } else if (!page.title) {
      await supabase
        .from("site_pages")
        .update({ title: def.title })
        .eq("id", page.id);
    }

    if (section.page_id !== page.id) {
      const { error } = await supabase
        .from("site_sections")
        .update({ page_id: page.id, sort_order: 0 })
        .eq("id", section.id);
      if (error) return { ok: false, error: error.message };
      section.page_id = page.id;
    }
  }

  // Refresh in-memory visibility for nav/footer rewrite (after moves).
  const visibleSections = sections.map((s) => ({
    type: s.type,
    isVisible: s.is_visible !== false,
  }));

  return rewriteChromeProps({
    supabase,
    sections: sections.filter((s) => s.page_id === home.id),
    homeId: home.id,
    mode: "website",
    visibleSections,
    profile,
  });
}

async function collapseToLandingPage(args: {
  supabase: SupabaseClient;
  churchId: string;
  home: PageRow;
  pages: PageRow[];
  sections: SectionRow[];
  profile: SiteProfile;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, churchId, home, pages, sections, profile } = args;

  // Move every section back onto home, then delete empty subpages.
  for (const section of sections) {
    if (section.page_id === home.id) continue;
    const { error } = await supabase
      .from("site_sections")
      .update({ page_id: home.id })
      .eq("id", section.id);
    if (error) return { ok: false, error: error.message };
    section.page_id = home.id;
  }

  const ordered = sortSectionsForLanding(
    sections.map((s) => ({
      id: s.id,
      type: s.type,
      sortOrder: s.sort_order,
    })),
  );

  for (let index = 0; index < ordered.length; index += 1) {
    const { error } = await supabase
      .from("site_sections")
      .update({ sort_order: index * 10 })
      .eq("id", ordered[index].id);
    if (error) return { ok: false, error: error.message };
  }

  const subpageIds = pages.filter((p) => p.path !== "/").map((p) => p.id);
  if (subpageIds.length > 0) {
    const { error } = await supabase
      .from("site_pages")
      .delete()
      .eq("church_id", churchId)
      .in("id", subpageIds);
    if (error) return { ok: false, error: error.message };
  }

  const visibleSections = sections.map((s) => ({
    type: s.type,
    isVisible: s.is_visible !== false,
  }));

  return rewriteChromeProps({
    supabase,
    sections: sections.filter((s) => s.page_id === home.id),
    homeId: home.id,
    mode: "landing",
    visibleSections,
    profile,
  });
}

async function rewriteChromeProps(args: {
  supabase: SupabaseClient;
  sections: SectionRow[];
  homeId: string;
  mode: SiteLayoutMode;
  visibleSections: { type: string; isVisible: boolean }[];
  profile: SiteProfile;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, sections, homeId, mode, visibleSections, profile } = args;

  const navLinks = buildSiteNavLinks(mode, visibleSections, profile);
  const visitCta = buildVisitCta(mode);
  const heroActions = buildHeroActions(mode, profile.media.length > 0);
  const footerLinks = buildFooterExploreLinks(mode, visibleSections, profile);

  for (const section of sections) {
    if (section.page_id !== homeId) continue;

    const props = { ...(section.props ?? {}) };
    let next = rewriteKnownHrefs(props, mode) as Record<string, unknown>;

    if (section.type === "site_nav") {
      next = { ...next, links: navLinks, cta: visitCta };
    } else if (section.type === "hero") {
      next = { ...next, actions: heroActions };
    } else if (section.type === "footer_map") {
      const extraColumns = Array.isArray(next.extraColumns)
        ? (next.extraColumns as Record<string, unknown>[])
        : [];
      const exploreIdx = extraColumns.findIndex(
        (col) => col?.heading === "Explore" || Array.isArray(col?.links),
      );
      if (exploreIdx >= 0) {
        const previous = extraColumns[exploreIdx] ?? {};
        const copy = extraColumns.slice();
        copy[exploreIdx] = {
          ...previous,
          heading:
            typeof previous.heading === "string" && previous.heading.trim()
              ? previous.heading
              : "Explore",
          links: footerLinks,
        };
        next = { ...next, extraColumns: copy };
      } else {
        next = {
          ...next,
          extraColumns: [
            ...extraColumns,
            { heading: "Explore", links: footerLinks },
          ],
        };
      }
    } else {
      // Non-chrome home sections still get hash/path rewrites (e.g. leftover CTAs).
    }

    const { error } = await supabase
      .from("site_sections")
      .update({ props: next })
      .eq("id", section.id);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}
