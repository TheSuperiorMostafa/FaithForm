import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { connect, one, suiteOptions } from "./groups-fixtures";

test("simultaneous retries with one request key create one church", suiteOptions, async () => {
  const first = await connect();
  const second = await connect();
  const key = randomUUID();
  const name = `QA church ${key}`;
  const insert = (client: typeof first, slug: string, requestKey: string) =>
    one<{ id: string }>(client,
      `insert into public.churches (name, slug, admin_create_request_id)
       values ($1, $2, $3) returning id`,
      [name, slug, requestKey]);

  try {
    const attempts = await Promise.allSettled([
      insert(first, `qa-${randomUUID()}`, key),
      insert(second, `qa-${randomUUID()}`, key),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.equal((rejected as PromiseRejectedResult).reason.code, "23505");
    const createdId = (attempts.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value.id;

    const saved = await one<{ id: string; count: string }>(first,
      `select min(id::text) as id, count(*)::text as count
         from public.churches where admin_create_request_id = $1`, [key]);
    assert.equal(saved.count, "1");
    assert.equal(saved.id, createdId);

    // A genuinely separate request may create another church of the same name.
    const other = await insert(first, `qa-${randomUUID()}`, randomUUID());
    assert.notEqual(other.id, createdId);
  } finally {
    try {
      await first.query(`delete from public.churches where name = $1`, [name]);
    } finally {
      await first.end();
      await second.end();
    }
  }
});
