import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connect, one, suiteOptions, withChurch, type Client } from "./groups-fixtures";

type Reservation = { ok: boolean; domainId?: string; domainIds?: string[]; code?: string };
type Claim = { domain_id: string; lease_token: string; attempts: number; operation: string };
const name = () => `church-${randomUUID().slice(0, 8)}.example`;
async function reserve(c: Client, churchId: string, hostname: string, companion: string | null = `www.${hostname}`, details = {}): Promise<Reservation> {
  return (await one<{ result: Reservation }>(c, "select public.reserve_site_domain_setup($1,$2,$3,null,$4::jsonb) result", [churchId, hostname, companion, JSON.stringify(details)])).result;
}
async function claim(c: Client, id: string): Promise<Claim | undefined> {
  return (await c.query("select * from public.claim_site_domain_jobs(1,$1)", [id])).rows[0] as Claim | undefined;
}
async function finish(c: Client, job: Claim, phase = "ready", activate = phase === "ready", next: string | null = new Date(Date.now() + 3600_000).toISOString()): Promise<boolean> {
  return (await one<{ result: boolean }>(c, "select public.finish_site_domain_job($1,$2,$3,'[]','[]',$4,$5,$6) result", [job.domain_id, job.lease_token, phase, phase === "attention" ? "check_unavailable" : null, next, activate])).result;
}
async function retry(c: Client, churchId: string, id: string): Promise<boolean> {
  return (await one<{ result: boolean }>(c, "select public.request_site_domain_check($1,$2) result", [churchId, id])).result;
}
async function ready(c: Client, churchId: string, hostname: string): Promise<string> {
  const r = await reserve(c, churchId, hostname, null);
  assert.equal(r.ok, true); const j = await claim(c, r.domainId!); assert.ok(j); assert.equal(await finish(c, j), true); return r.domainId!;
}

test("domain worker tables and RPCs are service-only with RLS", suiteOptions, async () => {
  const c = await connect();
  try {
    const row = await one(c, `select
      (select relrowsecurity from pg_class where oid='public.site_domain_jobs'::regclass) jobs_rls,
      (select relrowsecurity from pg_class where oid='public.site_domain_setup_events'::regclass) events_rls,
      has_table_privilege('authenticated','public.site_domain_jobs','SELECT') customer_read,
      has_table_privilege('anon','public.site_domain_setup_events','INSERT') anon_audit,
      has_function_privilege('authenticated','public.reserve_site_domain_setup(uuid,text,text,uuid,jsonb)','EXECUTE') customer_reserve,
      has_function_privilege('anon','public.claim_site_domain_jobs(integer,uuid)','EXECUTE') anon_claim,
      has_function_privilege('authenticated','public.finish_site_domain_job(uuid,uuid,text,jsonb,jsonb,text,timestamptz,boolean)','EXECUTE') customer_finish,
      has_function_privilege('authenticated','public.request_site_domain_disconnect(uuid,uuid)','EXECUTE') customer_disconnect,
      has_function_privilege('authenticated','public.set_primary_site_domain(uuid,uuid)','EXECUTE') customer_primary,
      has_function_privilege('authenticated','public.request_site_domain_check(uuid,uuid)','EXECUTE') customer_retry,
      has_table_privilege('service_role','public.site_domain_jobs','UPDATE') worker_write`);
    assert.deepEqual(row, { jobs_rls: true, events_rls: true, customer_read: false, anon_audit: false, customer_reserve: false, anon_claim: false, customer_finish: false, customer_disconnect: false, customer_primary: false, customer_retry: false, worker_write: true });
    await c.query("set role anon");
    await assert.rejects(c.query("select * from public.site_domain_jobs"), (e: unknown) => (e as {code?: string}).code === "42501");
    await assert.rejects(c.query("select public.claim_site_domain_jobs()"), (e: unknown) => (e as {code?: string}).code === "42501");
  } finally { await c.query("reset role"); await c.end(); }
});

test("reservation is atomic, retryable, and preserves request details and existing live content", suiteOptions, async () => {
  await withChurch(async (c, church) => {
    await c.query("set role service_role");
    const hostname = name();
    const initial = await reserve(c, church.id, hostname, `www.${hostname}`, { registrar: " Cloudflare ", contact_name: " Church IT ", contact_email: "it@example.test", notes: "Keep church email working" });
    assert.equal(initial.ok, true); assert.equal(initial.domainIds?.length, 2);
    const rows = (await c.query("select d.hostname,d.is_primary,j.redirect_to,j.operation,j.phase from public.site_domains d join public.site_domain_jobs j on j.domain_id=d.id where d.church_id=$1 order by d.hostname", [church.id])).rows;
    assert.equal(rows.find(r => r.hostname === hostname)?.is_primary, true);
    assert.equal(rows.find(r => r.hostname === `www.${hostname}`)?.redirect_to, hostname);
    const firstRequest = await one(c, "select id,registrar,contact_name,notes from public.site_domain_requests where church_id=$1", [church.id]);
    assert.equal(firstRequest.registrar, "Cloudflare"); assert.equal(firstRequest.contact_name, "Church IT");
    const again = await reserve(c, church.id, hostname, `www.${hostname}`, { contact_name: "Updated IT" });
    assert.equal(again.domainId, initial.domainId);
    const secondRequest = await one(c, "select id,registrar,contact_name,notes from public.site_domain_requests where church_id=$1", [church.id]);
    assert.equal(secondRequest.id, firstRequest.id); assert.equal(secondRequest.contact_name, "Updated IT"); assert.equal(secondRequest.notes, firstRequest.notes);
    await c.query("update public.site_domains set status='live',verified_at=now() where id=$1", [initial.domainId]);
    await c.query("update public.site_domain_requests set status='completed',admin_notes='Keep this completed request' where id=$1", [firstRequest.id]);
    assert.equal((await reserve(c, church.id, hostname)).ok, true);
    assert.equal((await one(c, "select count(*)::int n from public.site_domain_requests where church_id=$1", [church.id])).n, 1);
    assert.equal((await one(c, "select status from public.site_domains where id=$1", [initial.domainId])).status, "live");
    assert.equal((await reserve(c, church.id, "faithform.io")).code, "invalid_domain");
    assert.equal((await reserve(c, church.id, name(), null, { notes: "x".repeat(4001) })).code, "invalid_details");
  });
});

test("foreign claims and registration requests refuse the whole family without leaking ownership", suiteOptions, async () => {
  await withChurch(async (c, church) => { await withChurch(async (other, foreign) => {
    const hostname = name();
    await other.query("insert into public.site_domains(church_id,hostname) values($1,$2)", [foreign.id, `www.${hostname}`]);
    assert.deepEqual(await reserve(c, church.id, hostname), { ok: false, code: "domain_unavailable" });
    assert.equal((await one(c, "select count(*)::int n from public.site_domains where church_id=$1", [church.id])).n, 0);
    const requested = name();
    await other.query("insert into public.site_domain_requests(church_id,kind,hostname) values($1,'register_new',$2)", [foreign.id, requested]);
    assert.deepEqual(await reserve(c, church.id, requested), { ok: false, code: "domain_unavailable" });
    const own = name();
    await c.query("insert into public.site_domain_requests(church_id,kind,hostname) values($1,'register_new',$2)", [church.id, own]);
    assert.deepEqual(await reserve(c, church.id, name()), { ok: false, code: "request_in_progress" });
    assert.equal((await one(c, "select kind from public.site_domain_requests where church_id=$1", [church.id])).kind, "register_new");
  }); });
});

test("two churches racing for one hostname produce exactly one complete reservation", suiteOptions, async () => {
  await withChurch(async (first, a) => { await withChurch(async (second, b) => {
    const hostname = name(); await first.query("begin");
    const winner = await reserve(first, a.id, hostname); assert.equal(winner.ok, true);
    await second.query("set statement_timeout='3s'");
    const pending = reserve(second, b.id, hostname);
    await first.query("commit");
    assert.deepEqual(await pending, { ok: false, code: "domain_unavailable" });
    assert.equal((await one(first, "select count(*)::int n from public.site_domains where hostname=any($1)", [[hostname, `www.${hostname}`]])).n, 2);
    await assert.rejects(second.query("insert into public.site_domain_requests(church_id,kind,hostname) values($1,'register_new',$2)", [b.id, hostname]), (e: unknown) => (e as {code?: string}).code === "23505");
  }); });
});

test("failed family insert rolls back canonical, companion, job and request together", suiteOptions, async () => {
  await withChurch(async (c, church) => {
    const hostname = name();
    await c.query("alter table public.site_domain_jobs add constraint qa_reject_companion check(redirect_to is null) not valid");
    try { await assert.rejects(reserve(c, church.id, hostname), (e: unknown) => (e as {code?: string}).code === "23514"); }
    finally { await c.query("alter table public.site_domain_jobs drop constraint qa_reject_companion"); }
    assert.equal((await one(c, "select count(*)::int n from public.site_domains where church_id=$1", [church.id])).n, 0);
    assert.equal((await one(c, "select count(*)::int n from public.site_domain_requests where church_id=$1", [church.id])).n, 0);
  });
});

test("workers skip locked jobs, recover expired leases, and reject stale completion", suiteOptions, async () => {
  await withChurch(async (first, church) => {
    const second = await connect();
    try {
      const r = await reserve(first, church.id, name(), null);
      await first.query("begin"); const initial = await claim(first, r.domainId!); assert.ok(initial);
      await second.query("set statement_timeout='2s'"); assert.equal(await claim(second, r.domainId!), undefined);
      await first.query("commit"); assert.equal(await claim(second, r.domainId!), undefined);
      await second.query("update public.site_domain_jobs set lease_until=now()-interval '1 second' where domain_id=$1", [r.domainId]);
      const recovered = await claim(second, r.domainId!); assert.ok(recovered); assert.equal(recovered.attempts, 2); assert.notEqual(recovered.lease_token, initial.lease_token);
      assert.equal(await finish(first, initial), false); assert.equal(await finish(second, recovered), true);
    } finally { await first.query("rollback"); await second.end(); }
  });
});

test("only a fully ready family completes the matching request and failed checks preserve routing", suiteOptions, async () => {
  await withChurch(async (c, church) => {
    const hostname = name(), r = await reserve(c, church.id, hostname);
    const alias = await one<{id: string}>(c, "select id from public.site_domains where hostname=$1", [`www.${hostname}`]);
    const aliasJob = await claim(c, alias.id); assert.ok(aliasJob); assert.equal(await finish(c, aliasJob), true);
    assert.equal((await one(c, "select status from public.site_domain_requests where church_id=$1", [church.id])).status, "in_progress");
    const root = await claim(c, r.domainId!); assert.ok(root); assert.equal(await finish(c, root), true);
    assert.equal((await one(c, "select status from public.site_domain_requests where church_id=$1", [church.id])).status, "completed");
    const known = await one(c, "select verified_at from public.site_domains where id=$1", [r.domainId]);
    await c.query("update public.site_domain_jobs set available_at=now() where domain_id=$1", [r.domainId]);
    const failed = await claim(c, r.domainId!); assert.ok(failed); assert.equal(await finish(c, failed, "attention", false), true);
    const retained = await one(c, "select status,verified_at from public.site_domains where id=$1", [r.domainId]);
    assert.equal(retained.status, "live"); assert.deepEqual(retained.verified_at, known.verified_at);
    assert.equal((await one(c, "select count(*)::int n from public.site_domain_setup_events where domain_id=$1", [r.domainId])).n, 2);
  });
});

test("simultaneous canonical and companion completion closes the request immediately", suiteOptions, async () => {
  await withChurch(async (first, church) => {
    const second = await connect();
    try {
      const hostname = name(), r = await reserve(first, church.id, hostname);
      const alias = await one<{id:string}>(first, "select id from public.site_domains where hostname=$1", [`www.${hostname}`]);
      const rootJob = await claim(first, r.domainId!), aliasJob = await claim(second, alias.id);
      assert.ok(rootJob); assert.ok(aliasJob);
      await first.query("set statement_timeout='3s'"); await second.query("set statement_timeout='3s'");
      assert.deepEqual(await Promise.all([finish(first, rootJob), finish(second, aliasJob)]), [true, true]);
      assert.equal((await one(first, "select status from public.site_domain_requests where church_id=$1", [church.id])).status, "completed");
    } finally { await second.end(); }
  });
});

test("paused jobs require an allowed scoped retry; cooldown, active leases and Retry-After are respected", suiteOptions, async () => {
  await withChurch(async (c, church) => { await withChurch(async (_other, foreign) => {
    const r = await reserve(c, church.id, name()); const root = await claim(c, r.domainId!); assert.ok(root);
    assert.equal(await finish(c, root, "attention", false, null), true);
    assert.equal(await claim(c, r.domainId!), undefined);
    assert.equal(await retry(c, foreign.id, r.domainId!), false);
    assert.equal(await retry(c, church.id, r.domainId!), true);
    assert.equal((await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId])).available_at, null, "recent check cannot be hammered");
    await c.query("update public.site_domain_jobs set checked_at=now()-interval '1 minute', available_at=now()+interval '1 hour' where domain_id=any($1)", [r.domainIds]);
    assert.equal(await retry(c, church.id, r.domainId!), true);
    assert.equal((await one(c, "select count(*)::int n from public.site_domain_jobs where domain_id=any($1) and available_at<=now()", [r.domainIds])).n, 2);
    const leased = await claim(c, r.domainId!); assert.ok(leased);
    const before = await one(c, "select available_at,lease_token from public.site_domain_jobs where domain_id=$1", [r.domainId]);
    await retry(c, church.id, r.domainId!);
    assert.deepEqual(await one(c, "select available_at,lease_token from public.site_domain_jobs where domain_id=$1", [r.domainId]), before);
    await c.query("update public.site_domain_jobs set lease_token=null,lease_until=null,last_error_code='rate_limited',available_at=now()+interval '1 hour',checked_at=now()-interval '1 minute' where domain_id=$1", [r.domainId]);
    const rateLimited = await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId]);
    await retry(c, church.id, r.domainId!);
    assert.deepEqual((await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId])).available_at, rateLimited.available_at);
    assert.equal((await reserve(c, church.id, (await one<{hostname: string}>(c, "select hostname from public.site_domains where id=$1", [r.domainId])).hostname)).ok, true);
    assert.deepEqual((await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId])).available_at, rateLimited.available_at, "resubmission cannot bypass Retry-After");
    await c.query("update public.site_domain_jobs set last_error_code='unauthorized',available_at=null where domain_id=$1", [r.domainId]);
    await retry(c, church.id, r.domainId!); assert.ok(await claim(c, r.domainId!));
  }); });
});

test("disconnect fences in-flight connects, retains ownership until release, and preserves its audit", suiteOptions, async () => {
  await withChurch(async (c, church) => {
    await c.query("set role service_role");
    const hostname = name(), r = await reserve(c, church.id, hostname);
    const active = await claim(c, r.domainId!); assert.ok(active);
    assert.equal((await one(c, "select public.request_site_domain_disconnect($1,$2) result", [church.id, r.domainId])).result, true);
    assert.equal(await finish(c, active), false);
    assert.equal((await one(c, "select status from public.site_domains where id=$1", [r.domainId])).status, "failed");
    assert.equal((await one(c, "select status from public.site_domain_requests where church_id=$1", [church.id])).status, "cancelled");
    assert.equal(await claim(c, r.domainId!), undefined, "wait out the old provider call's lease");
    assert.equal((await reserve(c, church.id, hostname)).code, "disconnect_in_progress");
    await c.query("update public.site_domain_jobs set last_error_code='rate_limited',available_at=now()+interval '1 hour' where domain_id=$1", [r.domainId]);
    const retryAfter = (await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId])).available_at;
    await c.query("select public.request_site_domain_disconnect($1,$2)", [church.id, r.domainId]);
    assert.deepEqual((await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId])).available_at, retryAfter, "repeat removal cannot bypass Retry-After");
    await c.query("update public.site_domain_jobs set last_error_code='unauthorized',available_at=null,checked_at=now()-interval '1 minute' where domain_id=$1", [r.domainId]);
    await c.query("select public.request_site_domain_disconnect($1,$2)", [church.id, r.domainId]);
    assert.ok((await one(c, "select available_at from public.site_domain_jobs where domain_id=$1", [r.domainId])).available_at, "repeat removal resumes paused work");
    assert.equal((await one(c, "select public.finish_site_domain_disconnect($1,$2) result", [r.domainId, randomUUID()])).result, false);
    await c.query("update public.site_domain_jobs set available_at=now() where domain_id=any($1)", [r.domainIds]);
    for (const id of r.domainIds!) {
      const removal = await claim(c, id); assert.ok(removal); assert.equal(removal.operation, "disconnect");
      assert.equal((await one(c, "select public.finish_site_domain_disconnect($1,$2) result", [id, removal.lease_token])).result, true);
    }
    assert.equal((await one(c, "select count(*)::int n from public.site_domains where church_id=$1", [church.id])).n, 0);
    const events = (await c.query("select domain_id,hostname,event from public.site_domain_setup_events where church_id=$1", [church.id])).rows;
    assert.equal(events.length, 4); assert.ok(events.every(e => e.domain_id === null && typeof e.hostname === "string"));
    assert.equal((await reserve(c, church.id, hostname)).ok, true);
  });
});

test("primary switching is atomic, rejects aliases/foreign/pending rows, and removal selects a ready replacement", suiteOptions, async () => {
  await withChurch(async (c, church) => { await withChurch(async (_other, foreign) => {
    const first = await ready(c, church.id, name()), second = await ready(c, church.id, name());
    assert.equal((await one(c, "select public.set_primary_site_domain($1,$2) result", [foreign.id, second])).result, false);
    assert.equal((await one(c, "select public.set_primary_site_domain($1,$2) result", [church.id, second])).result, true);
    assert.equal((await one(c, "select count(*)::int n from public.site_domains where church_id=$1 and is_primary", [church.id])).n, 1);
    assert.equal((await one(c, "select public.request_site_domain_disconnect($1,$2) result", [church.id, second])).result, true);
    assert.equal((await one(c, "select id from public.site_domains where church_id=$1 and is_primary", [church.id])).id, first);
    const pending = await reserve(c, church.id, name());
    assert.equal(pending.ok, true);
    assert.equal((await one(c, "select public.set_primary_site_domain($1,$2) result", [church.id, pending.domainId])).result, false);
    const alias = await one<{id:string}>(c, "select id from public.site_domains where church_id=$1 and hostname like 'www.%'", [church.id]);
    assert.equal((await one(c, "select public.set_primary_site_domain($1,$2) result", [church.id, alias.id])).result, false);
    assert.equal((await one(c, "select id from public.site_domains where church_id=$1 and is_primary", [church.id])).id, first);
  }); });
});
