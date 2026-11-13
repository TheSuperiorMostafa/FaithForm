import assert from "node:assert/strict";
import test from "node:test";
import {colorContrast} from "@/lib/branding/color-contrast";
import {resolveTokens} from "@/lib/sites/resolve";
import {CODE_SITE_THEMES} from "@/lib/sites/themes";

test("theme and custom color foregrounds meet normal-text contrast without rewriting saved colors",()=>{
  const colors=["#FFFFFF","#000000","#777777","#B1A7E8","#112244","#FFC83D"];
  for(const theme of Object.values(CODE_SITE_THEMES)) for(const ink of colors) for(const canvas of colors) for(const accent of colors){
    const brand={"--site-ink":ink,"--site-ink-strong":ink,"--site-canvas":canvas,"--site-canvas-alt":canvas,"--site-surface":canvas,"--site-accent":accent};
    const tokens=resolveTokens(theme,{themeKey:theme.key,brandTokens:brand,customCss:null,contactEmail:null,isPublished:true,layoutMode:"landing"},null);
    for(const [key,value] of Object.entries(brand)) assert.equal(tokens[key],value);
    for(const [role,background] of Object.entries({ink,"ink-strong":ink,canvas,"canvas-alt":canvas,surface:canvas,accent})){
      for(const suffix of ["","-body","-muted","-accent"]) assert.ok(colorContrast(tokens[`--site-on-${role}${suffix}`],background)>=4.5,`${theme.key} ${role}${suffix} on ${background}`);
    }
  }
});

test("automatically mixed footer/canvas shades get their own readable foreground",()=>{
  const tokens=resolveTokens(CODE_SITE_THEMES.grace,{themeKey:"grace",brandTokens:{"--site-ink":"#FFFFFF","--site-canvas":"#777777"},customCss:null,contactEmail:null,isPublished:true,layoutMode:"landing"},null);
  assert.ok(colorContrast(tokens["--site-on-ink-strong"],"#c7c7c7")>=4.5);
  assert.ok(colorContrast(tokens["--site-on-canvas-alt"],"#7c7c7c")>=4.5);
});
