import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { asUser, one, suiteOptions, withChurch, type Client } from "./groups-fixtures";

async function publish(client: Client, churchId: string, published: boolean): Promise<string> {
  const result = await one<{ outcome: string }>(
    client,
    "select public.set_site_publication($1, $2) as outcome",
    [churchId, published],
  );
  return result.outcome;
}

async function asServiceRole<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    const result = await work();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

test("website publish and unpublish change both records atomically", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    await client.query(
      "insert into public.site_pages (church_id, path, status) values ($1, '/', 'draft')",
      [church.id],
    );
    await client.query(
      "insert into public.site_settings (church_id, is_published) values ($1, false)",
      [church.id],
    );
    await client.query(
      "insert into public.site_sections (church_id, page_id, type, props) select $1, id, 'hero', '{}'::jsonb from public.site_pages where church_id = $1 and path = '/'",
      [church.id],
    );

    assert.equal(await asServiceRole(client, () => publish(client, church.id, true)), "published");
    let state = await one<{ status: string; is_published: boolean }>(client,
      `select p.status, s.is_published from public.site_pages p
       join public.site_settings s on s.church_id = p.church_id
       where p.church_id = $1 and p.path = '/'`, [church.id]);
    assert.deepEqual(state, { status: "published", is_published: true });

    assert.equal(await asServiceRole(client, () => publish(client, church.id, false)), "unpublished");
    state = await one<{ status: string; is_published: boolean }>(client,
      `select p.status, s.is_published from public.site_pages p
       join public.site_settings s on s.church_id = p.church_id
       where p.church_id = $1 and p.path = '/'`, [church.id]);
    assert.deepEqual(state, { status: "draft", is_published: false });

    // Force the second write to fail. PostgreSQL must roll back the page's
    // earlier status change in the same RPC transaction.
    await client.query("begin");
    try {
      await client.query(`alter table public.site_settings
        add constraint qa_deny_publish check (not is_published) not valid`);
      await client.query("set local role service_role");
      await assert.rejects(publish(client, church.id, true), /qa_deny_publish/);
    } finally {
      await client.query("rollback");
    }
    state = await one<{ status: string; is_published: boolean }>(client,
      `select p.status, s.is_published from public.site_pages p
       join public.site_settings s on s.church_id = p.church_id
       where p.church_id = $1 and p.path = '/'`, [church.id]);
    assert.deepEqual(state, { status: "draft", is_published: false });

    await asUser(client, null, async () => {
      await assert.rejects(publish(client, church.id, true), (error: unknown) => (error as { code?: string }).code === "42501");
    });
    await asUser(client, randomUUID(), async () => {
      await assert.rejects(publish(client, church.id, true), (error: unknown) => (error as { code?: string }).code === "42501");
    });
  });
});

test("website publication refuses a church without a home page", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    assert.equal(await asServiceRole(client, () => publish(client, church.id, true)), "no_page");
    assert.equal(await asServiceRole(client, () => publish(client, church.id, false)), "no_page");
    const settings = await one<{ count: string }>(client,
      "select count(*)::text as count from public.site_settings where church_id = $1", [church.id]);
    assert.equal(settings.count, "0");
  });
});

test("website publication refuses an empty first draft without writing settings or page statuses", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    await client.query("insert into public.site_pages (church_id, path, status) values ($1, '/', 'draft'), ($1, '/about', 'draft')", [church.id]);
    assert.equal(await asServiceRole(client, () => publish(client, church.id, true)), "no_sections");
    assert.equal((await one<{ count: string }>(client, "select count(*)::text as count from public.site_settings where church_id = $1", [church.id])).count, "0");
    assert.deepEqual((await client.query("select path, status from public.site_pages where church_id = $1 order by path", [church.id])).rows,
      [{ path: "/", status: "draft" }, { path: "/about", status: "draft" }]);

    // Empty or damaged content must never prevent taking a site offline.
    await client.query("insert into public.site_settings (church_id, is_published) values ($1, true)", [church.id]);
    await client.query("update public.site_pages set status = 'published' where church_id = $1", [church.id]);
    assert.equal(await asServiceRole(client, () => publish(client, church.id, false)), "unpublished");
    assert.equal((await one<{ is_published: boolean }>(client, "select is_published from public.site_settings where church_id = $1", [church.id])).is_published, false);
    assert.equal((await one<{ count: string }>(client, "select count(*)::text as count from public.site_pages where church_id = $1 and status <> 'draft'", [church.id])).count, "0");
  });
});
