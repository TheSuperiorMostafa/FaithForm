/**
 * Test group_memberships RLS with active church relationship verification (migration 0148).
 * Security review: ensure account+membership+group same church and active relationship.
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("group_memberships RLS church relationship verification", () => {
  const admin = createAdminClient();
  let testChurch1: string;
  let testChurch2: string;
  let testUser: { id: string; email: string; client: SupabaseClient };
  let testAccount1: string;
  let testAccount2: string;
  let testGroup1: string;
  let testMembership1: string;

  before(async () => {
    // Create test churches
    const { data: church1 } = await admin.from("churches").insert({
      name: "Test Church 1",
      slug: `test-rls-church-1-${Date.now()}`,
    }).select("id").single();
    testChurch1 = church1!.id;

    const { data: church2 } = await admin.from("churches").insert({
      name: "Test Church 2",
      slug: `test-rls-church-2-${Date.now()}`,
    }).select("id").single();
    testChurch2 = church2!.id;

    // Create test user
    const email = `test-rls-${Date.now()}@example.com`;
    const { data: { user } } = await admin.auth.admin.createUser({
      email,
      password: "testpass123456",
      email_confirm: true,
    });
    testUser = {
      id: user!.id,
      email,
      client: await createUserClient(email, "testpass123456"),
    };

    // Create visitor accounts for both churches
    const { data: account1 } = await admin.from("visitor_accounts").insert({
      user_id: testUser.id,
      name: "Test User",
    }).select("id").single();
    testAccount1 = account1!.id;

    const { data: account2 } = await admin.from("visitor_accounts").insert({
      user_id: testUser.id,
      name: "Test User 2",
    }).select("id").single();
    testAccount2 = account2!.id;

    // Create active relationship for church 1
    await admin.from("visitor_church_relationships").insert({
      account_id: testAccount1,
      church_id: testChurch1,
      status: "active",
    });

    // Create inactive relationship for church 2
    await admin.from("visitor_church_relationships").insert({
      account_id: testAccount2,
      church_id: testChurch2,
      status: "inactive",
    });

    // Create test group in church 1
    const { data: group1 } = await admin.from("groups").insert({
      church_id: testChurch1,
      name: "Test Group",
      visibility: "visible",
      join_policy: "open",
    }).select("id").single();
    testGroup1 = group1!.id;

    // Create membership
    const { data: membership1 } = await admin.from("group_memberships").insert({
      church_id: testChurch1,
      group_id: testGroup1,
      account_id: testAccount1,
      group_role: "member",
      status: "active",
    }).select("id").single();
    testMembership1 = membership1!.id;
  });

  after(async () => {
    // Clean up in reverse dependency order
    if (testMembership1) {
      await admin.from("group_memberships").delete().eq("id", testMembership1);
    }
    if (testGroup1) {
      await admin.from("groups").delete().eq("id", testGroup1);
    }
    if (testAccount1) {
      await admin.from("visitor_church_relationships").delete().eq("account_id", testAccount1);
      await admin.from("visitor_accounts").delete().eq("id", testAccount1);
    }
    if (testAccount2) {
      await admin.from("visitor_church_relationships").delete().eq("account_id", testAccount2);
      await admin.from("visitor_accounts").delete().eq("id", testAccount2);
    }
    if (testUser.id) {
      await admin.auth.admin.deleteUser(testUser.id);
    }
    if (testChurch1) {
      await admin.from("churches").delete().eq("id", testChurch1);
    }
    if (testChurch2) {
      await admin.from("churches").delete().eq("id", testChurch2);
    }
  });

  it("allows updating own availability with active relationship", async () => {
    const { data, error } = await testUser.client
      .from("group_memberships")
      .update({ availability: "available" })
      .eq("id", testMembership1)
      .select();

    assert.equal(error, null, "Should allow update with active relationship");
    assert.ok(data && data.length > 0, "Should return updated row");
  });

  it("denies update without active relationship", async () => {
    // Create a membership in church 2 (user has inactive relationship)
    const { data: group2 } = await admin.from("groups").insert({
      church_id: testChurch2,
      name: "Test Group 2",
      visibility: "visible",
      join_policy: "open",
    }).select("id").single();

    const { data: membership2 } = await admin.from("group_memberships").insert({
      church_id: testChurch2,
      group_id: group2!.id,
      account_id: testAccount2,
      group_role: "member",
      status: "active",
    }).select("id").single();

    const { data, error } = await testUser.client
      .from("group_memberships")
      .update({ availability: "available" })
      .eq("id", membership2!.id)
      .select();

    // Clean up
    await admin.from("group_memberships").delete().eq("id", membership2!.id);
    await admin.from("groups").delete().eq("id", group2!.id);

    assert.ok(error || !data || data.length === 0, "Should deny update without active relationship");
  });

  it("denies cross-church updates", async () => {
    // Try to update church 1 membership while claiming to be from church 2 account
    // This should fail because the policy verifies membership.church_id = relationship.church_id
    const { data: crossGroup } = await admin.from("groups").insert({
      church_id: testChurch2,
      name: "Cross Church Group",
      visibility: "visible",
      join_policy: "open",
    }).select("id").single();

    // Manually insert cross-church membership (admin bypass)
    const { data: crossMembership } = await admin.from("group_memberships").insert({
      church_id: testChurch2,
      group_id: crossGroup!.id,
      account_id: testAccount1, // Account belongs to church 1
      group_role: "member",
      status: "active",
    }).select("id").single();

    // User should not be able to update this because account's active relationship
    // is with church 1, but membership is for church 2
    const { data, error } = await testUser.client
      .from("group_memberships")
      .update({ availability: "available" })
      .eq("id", crossMembership!.id)
      .select();

    // Clean up
    await admin.from("group_memberships").delete().eq("id", crossMembership!.id);
    await admin.from("groups").delete().eq("id", crossGroup!.id);

    assert.ok(error || !data || data.length === 0, "Should deny cross-church update");
  });
});

async function createUserClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createAdminClient();
  await client.auth.signInWithPassword({ email, password });
  return client;
}
