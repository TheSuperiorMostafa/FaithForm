import assert from "node:assert/strict";
import test from "node:test";
import { planSiteLayout } from "@/lib/sites/apply-layout-mode";
import { siteDetailsRowId } from "@/lib/sites/details-identity";
import { editableSectionContent } from "@/lib/sites/section-input";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { buildSections } from "@/lib/sites/generate";
import { resolvePage } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";

test("row retries keep the same UUID while churches and row kinds cannot share insert identities",()=>{
  const row={clientId:"new-row"};
  const first=siteDetailsRowId("church-a","staff",row);
  assert.match(first,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(siteDetailsRowId("church-a","staff",row),first);
  assert.notEqual(siteDetailsRowId("church-b","staff",row),first);
  assert.notEqual(siteDetailsRowId("church-a","serviceTimes",row),first);
  assert.equal(siteDetailsRowId("church-a","staff",{...row,id:first}),first);
});

test("layout round trips keep custom order and page-level copy with narrower manual edits winning",()=>{
  const pages=[{id:"home",path:"/",title:"Home",status:"published"},{id:"about-page",path:"/about",title:"Our story",status:"published"}];
  const sections=[
    {id:"nav",page_id:"home",type:"site_nav",sort_order:0,landing_sort_order:null,is_visible:true,props:{}},
    {id:"programs",page_id:"home",type:"programs_grid",sort_order:10,landing_sort_order:null,is_visible:true,props:{}},
    {id:"about",page_id:"home",type:"about_text",sort_order:20,landing_sort_order:null,is_visible:true,props:{}},
  ];
  const expanded=planSiteLayout({mode:"website",pages,sections,overrides:[],profile:DEV_PREVIEW_PROFILE});
  const moved=sections.map(row=>({...row,page_id:row.type==="about_text"?"about-page":row.type==="programs_grid"?"programs-page":"home",landing_sort_order:expanded.find(p=>p.id===row.id)!.landingSortOrder}));
  const overrides=[
    {scope:"page",page_id:"about-page",section_id:null,patch:{sections:{about_text:{headline:{lead:"Page lead",accent:"page"},body:["Page story"]}}}},
    {scope:"section",page_id:null,section_id:"about",patch:{headline:{accent:"manual"}}},
  ];
  const collapsed=planSiteLayout({mode:"landing",pages:[...pages,{id:"programs-page",path:"/programs",title:"Programs",status:"published"}],sections:moved,overrides,profile:DEV_PREVIEW_PROFILE});
  assert.deepEqual(collapsed.map(p=>[p.id,p.sortOrder]),[["nav",0],["programs",10],["about",20]]);
  assert.deepEqual(collapsed.find(p=>p.id==="about")?.patch,{headline:{lead:"Page lead",accent:"manual"},body:["Page story"]});
  assert.equal(collapsed.every(p=>p.path==="/"),true);
  assert.equal(pages[1].title,"Our story");
});

test("every generated editable section can be saved without structural changes and malformed content is rejected",()=>{
  const theme=CODE_SITE_THEMES.grace;
  const draft=buildSections(DEV_PREVIEW_PROFILE,null);
  const rows=draft.sections.map((s,i)=>({...s,id:`s${i}`,sortOrder:i*10,isVisible:true}));
  const page={id:"home",path:"/",title:"Home",metaDescription:null,status:"draft" as const};
  const resolved=resolvePage({page,theme,profile:DEV_PREVIEW_PROFILE,settings:null,sections:rows,overrides:[],registry:SECTION_REGISTRY});
  for(const section of resolved.sections) {
    const fields=SECTION_REGISTRY[section.type].fields;
    if(!fields) continue;
    assert.deepEqual(editableSectionContent(fields,section.content,section.content),section.content,section.type);
  }
  assert.throws(()=>editableSectionContent([{key:"title",type:"text",label:"Title"}],{}, {title:{html:"bad"}}));
  assert.throws(()=>editableSectionContent([{key:"items",type:"list",label:"Items",addLabel:"Add",itemFields:[]}],{}, {items:"bad"}));
  assert.throws(()=>editableSectionContent([{key:"href",type:"url",label:"Link"}],{}, {href:"javascript:alert(1)"}));
  assert.deepEqual(editableSectionContent([{key:"title",type:"text",label:"Title"}],{surface:"ink",title:"Old"},{title:"New",surface:"canvas",html:"<script>bad</script>"}),{surface:"ink",title:"New"});
});

test("trusted raw HTML ignores every church-controlled override scope",()=>{
  const result=resolvePage({
    page:{id:"home",path:"/",title:"Home",metaDescription:null,status:"published"},theme:CODE_SITE_THEMES.grace,settings:null,profile:DEV_PREVIEW_PROFILE,
    sections:[{id:"embed",type:"custom_embed",sortOrder:0,isVisible:true,props:{html:"<p>Trusted</p>"}}],
    overrides:[
      {scope:"church",pageId:null,sectionId:null,patch:{sections:{custom_embed:{html:"Church injection"}}}},
      {scope:"page",pageId:"home",sectionId:null,patch:{sections:{custom_embed:{html:"Page injection"}}}},
      {scope:"section",pageId:null,sectionId:"embed",patch:{html:"Section injection"}},
    ],registry:SECTION_REGISTRY,
  });
  assert.equal(result.sections[0].content.html,"<p>Trusted</p>");
});

test("profile-backed service days and times stay current without regenerating or overwriting manual copy",()=>{
  const original={...DEV_PREVIEW_PROFILE,serviceTimes:[{label:"Worship",dayOfWeek:0,startTime:"10:30",endTime:null,kind:"regular",notes:null}]};
  const updated={...original,serviceTimes:[{...original.serviceTimes[0],dayOfWeek:3,startTime:"18:00"}]};
  const generated=buildSections(original,null);
  const rows=generated.sections.map((s,i)=>({...s,id:`s${i}`,sortOrder:i*10}));
  const result=resolvePage({page:{id:"home",path:"/",title:"Home",metaDescription:null,status:"published"},theme:CODE_SITE_THEMES.grace,settings:null,profile:updated,sections:rows,overrides:[],registry:SECTION_REGISTRY});
  assert.deepEqual((result.sections.find(s=>s.type==="service_times")?.content.items as {value:string}[])[0].value,"Wed · 6:00 PM");
  assert.equal((result.sections.find(s=>s.type==="programs_grid")?.content.items as {when:string}[])[0].when,"Wed · 6:00 PM");
  assert.equal(((result.sections.find(s=>s.type==="footer_map")?.content.columns as {lines:string[]}[])[0].lines)[0],"Worship · Wed · 6:00 PM");
});
