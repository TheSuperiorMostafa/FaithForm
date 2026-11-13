import assert from "node:assert/strict";
import test from "node:test";
import { websiteActionRequest } from "@/components/website-admin/action-request";

test("interrupted website actions preserve typed results and turn rejected requests into recovery guidance",async()=>{
  assert.deepEqual(await websiteActionRequest(async()=>({ok:true as const,status:"live"})),{ok:true,status:"live"});
  const failure=await websiteActionRequest(async()=>{throw new Error("Raw backend error and credentials");});
  assert.equal(failure.ok,false);
  assert.match("error" in failure?failure.error:"",/Refresh this page/);
  assert.doesNotMatch(JSON.stringify(failure),/Raw backend|credentials/);
});
