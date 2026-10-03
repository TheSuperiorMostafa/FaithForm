import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisitorAccount } from "@/lib/faithform/account";
import { requestAccountAction } from "@/lib/faithform/account-lifecycle";
import { VisitorError } from "@/lib/faithform/errors";
import { retireInstallationsForAccount } from "@/lib/faithform/push/installations";
import { resolveRelationshipState } from "@/lib/mobile/v1/discovery-service";

function account(status: VisitorAccount["status"] = "active"): VisitorAccount {
  return {
    id: "account-a", userId: "user-a", displayName: "Person", avatarUrl: null,
    status, termsVersion: "1", termsAcceptedAt: null, privacyVersion: "1",
    privacyAcceptedAt: null, autoAttendanceConsent: "unset", communicationPrefs: {},
    selectedChurchId: null, authorizationVersion: 3,
  };
}

const requestRow = {
  id: "request-a", kind: "deletion", status: "pending",
  requested_at: "2026-10-03T00:00:00Z", completed_at: null,
};

/** A database double with independent failures between the durable writes. */
function fixture(options: { existing?: boolean; race?: boolean } = {}) {
  const current = account();
  let row: Record<string, unknown> | null = options.existing ? { ...requestRow } : null;
  let devicesEnabled = true;
  let failStatus = false;
  let failRetirement = false;
  let concurrentVersionChange = false;
  let inserts = 0;
  let retirements = 0;

  const admin = {
    from(table: string) {
      let operation = "read";
      let values: Record<string, unknown> = {};
      const predicates: [string, unknown][] = [];
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { predicates.push([key, value]); return query; },
        neq() { return query; },
        in() { return query; },
        insert(input: Record<string, unknown>) { operation = "insert"; values = input; return query; },
        update(input: Record<string, unknown>) { operation = "update"; values = input; return query; },
        async maybeSingle() { return execute(); },
        then(resolve: (value: ReturnType<typeof execute>) => unknown) {
          return Promise.resolve(execute()).then(resolve);
        },
      };
      function execute(): { data: Record<string, unknown> | null; error: object | null } {
        if (table === "visitor_account_requests") {
          if (operation === "insert") {
            inserts++;
            row = { ...requestRow, ...values };
            return options.race
              ? { data: null, error: { code: "23505" } }
              : { data: row, error: null };
          }
          return { data: row, error: null };
        }
        if (table === "visitor_accounts") {
          if (failStatus) return { data: null, error: { code: "write_failed" } };
          if (concurrentVersionChange) {
            current.authorizationVersion++;
            concurrentVersionChange = false;
          }
          const expectedVersion = predicates.find(([key]) => key === "authorization_version")?.[1];
          if (expectedVersion !== current.authorizationVersion) return { data: null, error: null };
          current.status = values.status as VisitorAccount["status"];
          current.authorizationVersion = values.authorization_version as number;
          return { data: { id: current.id }, error: null };
        }
        if (table === "visitor_device_installations") {
          retirements++;
          if (failRetirement) return { data: null, error: { code: "write_failed" } };
          assert.equal(values.provider_token, "");
          assert.deepEqual(predicates, [["account_id", current.id], ["is_enabled", true]]);
          devicesEnabled = false;
          return { data: null, error: null };
        }
        throw new Error(`Unexpected table ${table}`);
      }
      return query;
    },
  } as unknown as SupabaseClient;
  const dependencies = {
    getVisitorAccount: async () => ({ ...current }),
    createAdminClient: () => admin,
    retireInstallationsForAccount,
  };
  return {
    current, dependencies,
    submit: () => requestAccountAction("user-a", { kind: "deletion", idempotencyKey: "delete-key-a" }, dependencies),
    failStatus: (value: boolean) => { failStatus = value; },
    failRetirement: (value: boolean) => { failRetirement = value; },
    changeVersionDuringWrite: () => { concurrentVersionChange = true; },
    devicesEnabled: () => devicesEnabled,
    inserts: () => inserts,
    retirements: () => retirements,
  };
}

const unavailable = (error: unknown) => error instanceof VisitorError && error.code === "unavailable";

test("a failed deletion status write is retryable and the same request repairs it", async () => {
  const f = fixture();
  f.failStatus(true);
  await assert.rejects(f.submit(), unavailable);
  assert.equal(f.current.status, "active");
  assert.equal(f.retirements(), 0);
  f.failStatus(false);
  const result = await f.submit();
  assert.equal(result.id, requestRow.id);
  assert.equal(f.inserts(), 1);
  assert.equal(f.current.status, "deletion_requested");
  assert.equal(f.current.authorizationVersion, 4);
  assert.equal(f.devicesEnabled(), false);
});

test("retrying an existing deletion finishes interrupted notification retirement", async () => {
  const f = fixture();
  f.failRetirement(true);
  await assert.rejects(f.submit(), unavailable);
  assert.equal(f.current.status, "deletion_requested");
  assert.equal(f.devicesEnabled(), true);
  f.failRetirement(false);
  await f.submit();
  assert.equal(f.devicesEnabled(), false);
  assert.equal(f.inserts(), 1);
  assert.equal(f.retirements(), 2);
});

test("joining another device's open request also finishes deletion authority", async () => {
  const f = fixture({ race: true });
  assert.equal((await f.submit()).id, requestRow.id);
  assert.equal(f.current.status, "deletion_requested");
  assert.equal(f.devicesEnabled(), false);
});

test("a concurrent authorization bump is preserved and deletion retries with its latest version", async () => {
  const f = fixture();
  f.changeVersionDuringWrite();
  await assert.rejects(f.submit(), unavailable);
  assert.equal(f.current.authorizationVersion, 4);
  assert.equal(f.current.status, "active");
  await f.submit();
  assert.equal(f.current.authorizationVersion, 5);
  assert.equal(f.current.status, "deletion_requested");
});

test("inactive accounts cannot resolve a private publication relationship", async () => {
  for (const status of ["deactivated", "deletion_requested", "deleted"] as const) {
    let privateQueries = 0;
    const state = await resolveRelationshipState("user-a", "grace", {
      getVisitorAccount: async () => account(status),
      createAdminClient: () => { privateQueries++; throw new Error("Private relationship lookup must not run"); },
    });
    assert.equal(state, null, status);
    assert.equal(privateQueries, 0);
  }
});

test("active member relationships still resolve under their own account and church", async () => {
  const predicates: [string, string][] = [];
  const admin = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq(key: string, value: string) { predicates.push([key, value]); return query; },
        async maybeSingle() { return { data: table === "churches" ? { id: "church-a" } : { state: "joined" } }; },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  assert.equal(await resolveRelationshipState("user-a", "grace", {
    getVisitorAccount: async () => account(), createAdminClient: () => admin,
  }), "joined");
  assert.deepEqual(predicates, [["slug", "grace"], ["account_id", "account-a"], ["church_id", "church-a"]]);
});
