import assert from "node:assert/strict";
import test from "node:test";
import React,{createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {buildSections} from "@/lib/sites/generate";
import {DEV_PREVIEW_PROFILE} from "@/lib/sites/dev-preview-profile";
import {SECTION_REGISTRY} from "@/lib/sites/registry";
import {CODE_SITE_THEMES} from "@/lib/sites/themes";
import {diffPatch,resolvePage} from "@/lib/sites/resolve";
import {editableSectionContent} from "@/lib/sites/section-input";
import {blankSectionItem} from "@/components/website-admin/field-values";
import type {SectionField} from "@/lib/sites/contract";

Object.assign(globalThis,{React});
type Bag=Record<string,unknown>;
function mutations(field:SectionField,current:unknown):unknown[]{
  switch(field.type){
    case "text":case "textarea":return ["Field edit — church words",""];
    case "url":return ["https://example.invalid/visit?source=test#contact",""];
    case "toggle":return [true,false];
    case "number":return [field.min ?? 1,field.max ?? 5];
    case "select":return field.options.map(option=>option.value);
    case "paragraphs":return [["A pastor's first paragraph.","Another paragraph."],[]];
    case "headline":return [{lead:"Come and join us",accent:"welcome",trail:"this week"},{lead:"",accent:"",trail:""}];
    case "image":return [{src:"https://example.invalid/photo.jpg",alt:"Our church",placeholder:"Church photo"},{src:null,alt:"",placeholder:""}];
    case "list":{
      const item=Array.isArray(current) && current[0] && typeof current[0]==="object" ? current[0] as Bag : blankSectionItem(field.itemFields);
      const changed=field.itemFields.flatMap(child=>mutations(child,item[child.key]).map(value=>({...item,[child.key]:value})));
      return [[],...changed.map(value=>[value])];
    }
    case "group":{
      const group=current && typeof current==="object" && !Array.isArray(current)?current as Bag:{};
      return field.fields.flatMap(child=>mutations(child,group[child.key]).map(value=>({...group,[child.key]:value})));
    }
  }
}

for(const theme of Object.values(CODE_SITE_THEMES)) test(`${theme.name}: every declared field can be edited, cleared, resolved, rendered and reset`,t=>{
  const page={id:"home",path:"/",title:"Church website",metaDescription:null,status:"draft" as const};
  const rows=buildSections(DEV_PREVIEW_PROFILE,null).sections.map((row,index)=>({...row,id:`section-${index}`,sortOrder:index*10,isVisible:true}));
  const initial=resolvePage({page,theme,settings:null,profile:DEV_PREVIEW_PROFILE,sections:rows,overrides:[],registry:SECTION_REGISTRY});
  let checked=0;
  for(const section of initial.sections){
    const master=SECTION_REGISTRY[section.type],fields=master.fields;
    if(!fields) continue;
    for(const field of fields) for(const value of mutations(field,section.content[field.key])){
      const edited=editableSectionContent(fields,section.content,{...section.content,[field.key]:value});
      const patch=diffPatch(section.content,edited);
      const resolved=resolvePage({page,theme,settings:null,profile:DEV_PREVIEW_PROFILE,sections:rows,overrides:[{scope:"section",pageId:null,sectionId:section.ctx.id,patch}],registry:SECTION_REGISTRY}).sections.find(row=>row.ctx.id===section.ctx.id)!;
      assert.deepEqual(resolved.content,edited,`${section.type}.${field.key}`);
      assert.doesNotThrow(()=>renderToStaticMarkup(createElement(master.Component,{content:resolved.content,ctx:resolved.ctx})),`${section.type}.${field.key}`);
      assert.deepEqual(diffPatch(section.content,section.content),{});
      checked++;
    }
  }
  assert.ok(checked>100,"exercise nested lists, groups and every field kind");
  t.diagnostic(`${checked} edit/clear variants through validation + patch resolution + production section rendering`);
});
