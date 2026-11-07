import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connect } from "./groups-fixtures";
import { MEMBERSHIP_STATUSES } from "@/lib/people/membership-status";

const enabled = process.env.FAITHFORM_TEST_DATABASE_URL && process.env.FAITHFORM_FULL_SCHEMA === "1";
const options = enabled ? {} : { skip: "Needs an explicitly selected disposable full-schema database." };

test("People statuses default to Unknown, persist all six choices, and reject invalid values", options, async () => {
  const db = await connect();
  const church = randomUUID(), member = randomUUID();
  try {
    await db.query("begin");
    await db.query("insert into public.churches(id,name,slug) values ($1,'People status test',$1::uuid::text)", [church]);
    const { rows } = await db.query("insert into public.members(id,church_id,first_name,last_name) values ($1,$2,'Ann','Lee') returning membership_status", [member, church]);
    assert.equal(rows[0].membership_status, "unknown");
    for (const { value } of MEMBERSHIP_STATUSES) {
      const saved = await db.query("update public.members set membership_status=$1 where id=$2 and church_id=$3 returning membership_status", [value, member, church]);
      assert.equal(saved.rows[0].membership_status, value);
    }
    await db.query("savepoint invalid_status");
    await assert.rejects(db.query("update public.members set membership_status='admin' where id=$1", [member]), /members_membership_status_check/);
    await db.query("rollback to savepoint invalid_status");
  } finally {
    await db.query("rollback");
    await db.end();
  }
});

test("the classification read grant preserves the existing sensitive-column boundary", options, async () => {
  const db = await connect();
  try {
    const { rows: [privileges] } = await db.query(`select
      has_column_privilege('authenticated', 'public.members', 'membership_status', 'SELECT') as status,
      has_column_privilege('authenticated', 'public.members', 'id', 'SELECT') as id,
      has_column_privilege('authenticated', 'public.members', 'medical_notes', 'SELECT') as medical,
      has_column_privilege('anon', 'public.members', 'membership_status', 'SELECT') as anonymous,
      relrowsecurity as rls
      from pg_class where oid = 'public.members'::regclass`);
    assert.deepEqual(privileges, { status: true, id: true, medical: false, anonymous: false, rls: true });
  } finally { await db.end(); }
});
