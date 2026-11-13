import assert from "node:assert/strict";
import test from "node:test";
import React,{createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Action,Headline,QuietLink} from "@/components/sites/primitives";
import {PageRenderer} from "@/components/sites/PageRenderer";
import {siteNavSection} from "@/components/sites/sections/site-nav";
import {footerMapSection} from "@/components/sites/sections/footer-map";

Object.assign(globalThis,{React});
const ctx={id:"section",anchor:"section",index:0};

test("clearing text or destinations removes unnamed/dead buttons from public pages",()=>{
  for(const label of ["","   "]) {
    assert.equal(renderToStaticMarkup(createElement(Action,{action:{label,href:"/visit"}})),"");
    assert.equal(renderToStaticMarkup(createElement(QuietLink,{link:{label,href:"/visit"}})),"");
  }
  for(const href of [""," ","#"]) assert.equal(renderToStaticMarkup(createElement(Action,{action:{label:"Visit",href}})),"");
  assert.equal(renderToStaticMarkup(createElement(Headline,{headline:{lead:"",accent:" ",trail:""}})),"");
});

test("unfinished menu and footer rows remain saved but do not create empty keyboard targets",()=>{
  const links=[{label:"",href:"/about"},{label:"Visit",href:""},{label:"Our story",href:"/about"}];
  const nav=renderToStaticMarkup(createElement(siteNavSection.Component,{content:{...siteNavSection.defaults,title:"Our church",links,cta:{label:"",href:"/visit"}},ctx}));
  assert.match(nav,/Our story/);assert.doesNotMatch(nav,/>Visit<|href=""|href="#"/);
  const footer=renderToStaticMarkup(createElement(footerMapSection.Component,{content:{...footerMapSection.defaults,extraColumns:[{heading:"Explore",links}]},ctx}));
  assert.match(footer,/Our story/);assert.doesNotMatch(footer,/>Visit<|href=""/);
});

test("a hidden/cleared hero preserves the page's accessible main heading",()=>{
  for(const sections of [[],[{type:"hero",content:{headline:{lead:"",accent:"",trail:""},actions:[],image:null,body:null,eyebrow:null},ctx}]]) {
    const html=renderToStaticMarkup(createElement(PageRenderer,{page:{slug:"safe-test",themeKey:"grace",title:"Our church",metaDescription:null,tokens:{},customCss:null,sections}}));
    assert.match(html,/<h1 class="sr-only">Our church<\/h1>/);
  }
});
