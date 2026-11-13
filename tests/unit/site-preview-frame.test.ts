import assert from "node:assert/strict";
import test from "node:test";
import React, {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ColorPickerField} from "@/components/ui/color-picker-field";
import {colorContrast,readableColorText} from "@/lib/branding/color-contrast";
import {navigateSitePreview,previewFrameGeometry,previewLoadMessage} from "@/lib/sites/preview-frame";

Object.assign(globalThis,{React});

test("phone and desktop preview stay centered with a true CSS viewport at narrow and wide panel sizes",()=>{
  for(const viewport of [390,1280]) for(const panel of [240,320,390,760,1400]) {
    const geometry=previewFrameGeometry(panel,618,viewport);
    const paintedWidth=geometry.width*geometry.scale;
    const left=panel/2+geometry.marginLeft;
    assert.ok(left>=0);
    assert.ok(paintedWidth<=panel);
    assert.equal(left,(panel-paintedWidth)/2);
    assert.equal(geometry.width,viewport,"media queries see the device viewport");
    assert.equal(Math.round(geometry.height*geometry.scale),618);
  }
});

test("preview waits for saving and remains on the current page after rejected or stale navigation",async()=>{
  let finish!:(value:boolean)=>void;
  let moved=false;
  const queued=new Promise<boolean>(resolve=>{finish=resolve;});
  const next=navigateSitePreview("/about",async()=>queued,()=>{moved=true;},()=>true);
  await Promise.resolve(); assert.equal(moved,false);
  finish(false); assert.equal(await next,false); assert.equal(moved,false);
  assert.equal(await navigateSitePreview("/about",async()=>true,()=>{moved=true;},()=>false),false);
  assert.equal(moved,false);
  assert.equal(await navigateSitePreview("/about",async()=>true,()=>{moved=true;},()=>true),true);
  assert.equal(moved,true);
});

test("missing, signed-out and external preview pages receive usable recovery messages",()=>{
  assert.equal(previewLoadMessage({readable:true,hasWebsite:true}),null);
  assert.match(previewLoadMessage({readable:true,hasWebsite:false,pathname:"/login"})!,/Sign in again/);
  assert.match(previewLoadMessage({readable:true,hasWebsite:false})!,/Refresh this page/);
  assert.match(previewLoadMessage({readable:false,hasWebsite:false})!,/new tab/);
});

test("color picker labels remain readable on light, dark and midpoint custom colors",()=>{
  for(const red of [0,51,102,153,204,255]) for(const green of [0,51,102,153,204,255]) for(const blue of [0,51,102,153,204,255]) {
    const background=`#${[red,green,blue].map(n=>n.toString(16).padStart(2,"0")).join("")}`;
    assert.ok(colorContrast(background,readableColorText(background))>=4.5,background);
  }
  const html=renderToStaticMarkup(createElement(ColorPickerField,{id:"canvas",label:"Page background",value:"#FFFFFF",defaultColor:"#FFFFFF",onChange:()=>{}}));
  assert.match(html,/background-color:#FFFFFF;color:#000000/);
  assert.doesNotMatch(html,/text-white/);
});
