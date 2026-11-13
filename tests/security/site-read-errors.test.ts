import assert from "node:assert/strict";
import test from "node:test";
import { buildSiteProfile, countNewSubmissions, getContactSubmissions, getSiteMediaForChurch, getSiteThemes, getWebsiteForChurch, listSitePages } from "@/lib/sites/queries";
import { getChurchDomains, getChurchDomainRequests, getOpenDomainRequest, hostnameClaim } from "@/lib/sites/domain-queries";

test("failed website loads never masquerade as a new site, empty inbox or missing sermons",async t=>{
  const previous={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY};
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://website-errors.invalid";
  process.env.SUPABASE_SECRET_KEY="test-secret";
  t.after(()=>{
    if(previous.url===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=previous.url;
    if(previous.key===undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY=previous.key;
  });
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({code:"test_unavailable",message:"Database could not read that content"}),{status:400,headers:{"Content-Type":"application/json"}}));
  const church="11111111-1111-4111-8111-111111111111";
  for(const read of [()=>getWebsiteForChurch(church),()=>listSitePages(church),()=>getContactSubmissions(church),()=>countNewSubmissions(church),()=>getSiteMediaForChurch(church),()=>getSiteThemes(),()=>buildSiteProfile(church),()=>getChurchDomains(church),()=>getChurchDomainRequests(church),()=>getOpenDomainRequest(church),()=>hostnameClaim("church.example")]) await assert.rejects(read);
});
