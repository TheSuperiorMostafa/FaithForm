import type { SupabaseClient } from "@supabase/supabase-js";

import { buildFooterExploreLinks, buildHeroActions, buildSiteNavLinks, buildVisitCta,
  sortSectionsForLanding, websitePageDefForType, type SiteLayoutMode } from "@/lib/sites/layout-mode";
import { deepMerge } from "@/lib/sites/resolve";
import type { SiteProfile } from "@/types/site";

type SectionRow = {
  id: string; page_id: string; type: string; sort_order: number;
  landing_sort_order: number | null; is_visible: boolean; props: Record<string, unknown> | null;
};
type PageRow = { id: string; path: string; title: string | null; status: string };
type OverrideRow = { scope: string; page_id: string | null; section_id: string | null; patch: Record<string, unknown> };
export type SiteLayoutPlan = {
  id: string; sourcePageId: string; path: string; title: string;
  sortOrder: number; landingSortOrder: number; props: Record<string, unknown>;
  patch?: Record<string, unknown>;
};

/** Plan without mutating. Page-scoped manual content follows a section when
 * it moves; section edits remain the final layer. Empty pages are retained so
 * SEO metadata, titles and page settings survive changing back to that layout. */
export function planSiteLayout(args: {
  mode: SiteLayoutMode; pages: PageRow[]; sections: SectionRow[]; overrides: OverrideRow[]; profile: SiteProfile;
}): SiteLayoutPlan[] {
  const { mode, pages, sections, overrides, profile } = args;
  const home = pages.find(p => p.path === "/");
  if (!home) throw new Error("Your home page could not be found.");
  const visible = sections.map(s => ({type:s.type,isVisible:s.is_visible}));
  // Only legacy website rows lack an original landing position. Their old
  // sort_order=0 is insufficient to put nav/hero before the moved content.
  const legacy = sortSectionsForLanding(sections.map(s => ({...s,sortOrder:s.sort_order})));
  return sections.map(section => {
    const def = websitePageDefForType(section.type);
    const destination = mode === "website" && def ? def.path : "/";
    const source = pages.find(p => p.id === section.page_id);
    const landingOrder = source?.path === "/" && mode === "website"
      ? section.sort_order : section.landing_sort_order ?? legacy.findIndex(s => s.id === section.id)*10;
    let props = {...(section.props ?? {})};
    if (section.type === "site_nav") props = {...props,links:buildSiteNavLinks(mode,visible,profile),cta:buildVisitCta(mode)};
    if (section.type === "hero") props = {...props,actions:buildHeroActions(mode,profile.media.length>0)};
    if (section.type === "footer_map") {
      const columns = Array.isArray(props.extraColumns) ? props.extraColumns as Record<string,unknown>[] : [];
      const index = columns.findIndex(col => col?.heading === "Explore");
      const next = columns.slice();
      if (index>=0) next[index]={...next[index],links:buildFooterExploreLinks(mode,visible,profile)};
      else next.push({heading:"Explore",links:buildFooterExploreLinks(mode,visible,profile)});
      props = {...props,extraColumns:next};
    }
    const plan: SiteLayoutPlan = {
      id:section.id,sourcePageId:section.page_id,path:destination,title:def?.title ?? "Home",
      sortOrder:mode === "landing" ? landingOrder : section.sort_order,landingSortOrder:landingOrder,props,
    };
    if (source?.path !== destination && section.type !== "custom_embed") {
      const pageOverride = overrides.find(o => o.scope === "page" && o.page_id === section.page_id)?.patch;
      const byType = pageOverride?.sections as Record<string,Record<string,unknown>> | undefined;
      const pageContent = byType?.[section.type];
      if (pageContent && typeof pageContent === "object" && !Array.isArray(pageContent)) {
        const own = overrides.find(o => o.scope === "section" && o.section_id === section.id)?.patch;
        plan.patch = deepMerge(pageContent,own);
      }
    }
    return plan;
  });
}

export async function applySiteLayoutMode(args: {
  supabase: SupabaseClient; churchId: string; mode: SiteLayoutMode; profile: SiteProfile;
}): Promise<{ok:true}|{ok:false;error:string}> {
  const {supabase,churchId,mode,profile}=args;
  const [pages,sections,overrides]=await Promise.all([
    supabase.from("site_pages").select("id,path,title,status").eq("church_id",churchId),
    supabase.from("site_sections").select("id,page_id,type,sort_order,landing_sort_order,is_visible,props").eq("church_id",churchId),
    supabase.from("site_overrides").select("scope,page_id,section_id,patch").eq("church_id",churchId),
  ]);
  const readError=pages.error ?? sections.error ?? overrides.error;
  if(readError) return {ok:false,error:readError.message};
  let plan: SiteLayoutPlan[];
  try { plan=planSiteLayout({mode,pages:pages.data ?? [],sections:sections.data ?? [],overrides:overrides.data ?? [],profile}); }
  catch { return {ok:false,error:"Your website could not be loaded. Refresh the page and try again."}; }
  const {error}=await supabase.rpc("apply_site_layout",{p_church_id:churchId,p_mode:mode,p_plan:plan});
  return error ? {ok:false,error:error.message} : {ok:true};
}
