import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("cancellation retries are idempotent and scoped to the exact connected account", () => {
  const script = `
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const {require: loadTypeScript} = require("tsx/cjs/api");
    let state, failure, cancels;
    const options = {stripeAccount:"acct_verified",timeout:8000,maxNetworkRetries:0};
    const stripe = {subscriptions:{
      retrieve:async(id, params, opts)=>{assert.equal(id,"sub_verified");assert.deepEqual(opts,options);if(failure)throw {code:failure};return {status:state};},
      cancel:async(id, params, opts)=>{assert.equal(id,"sub_verified");assert.deepEqual(opts,options);cancels++;return {status:"canceled"};}
    }};
    const original = Module._load;
    Module._load = function(request) {if(request === "@/lib/stripe/client")return {getStripe:()=>stripe};return original.apply(this,arguments);};
    const {stripeGivingProvider} = loadTypeScript(process.cwd()+"/lib/giving/v1/payment-provider.ts",__filename);
    (async()=>{
      for(const terminal of ["canceled","incomplete_expired"]){state=terminal;failure=null;cancels=0;assert.equal(await stripeGivingProvider.cancelSubscription("acct_verified","sub_verified"),true);assert.equal(cancels,0);}
      state="active";failure=null;cancels=0;assert.equal(await stripeGivingProvider.cancelSubscription("acct_verified","sub_verified"),true);assert.equal(cancels,1);
      failure="resource_missing";assert.equal(await stripeGivingProvider.cancelSubscription("acct_verified","sub_verified"),true);
      failure="api_connection_error";assert.equal(await stripeGivingProvider.cancelSubscription("acct_verified","sub_verified"),false);
      failure="account_invalid";assert.equal(await stripeGivingProvider.cancelSubscription("acct_verified","sub_verified"),false);
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
