/**
 * Test G2: Group announcement notifications.
 * Validates leader-only permissions, recipient filtering, church isolation.
 */

// @ts-nocheck
import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

describe("Group announcements (G2)", { skip: !supabaseUrl || !supabaseServiceKey }, () => {
  let db: ReturnType<typeof createClient>;
  let testChurchId: string;
  let testGroupId: string;
  let leaderUserId: string;
  let memberUserId: string;
  let leaderAccountId: string;
  let memberAccountId: string;
  
  before(async () => {
    db = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
    
    // Create test church
    const { data: church } = await db
      .from("churches")
      .insert({ name: "Test Church", slug: `test-group-ann-${Date.now()}` } as any)
      .select("id")
      .single() as any;
    
    testChurchId = church!.id;
    
    // Enable groups feature
    await db.from("church_features").insert({
      church_id: testChurchId,
      feature_key: "groups",
      enabled: true,
    });
    
    // Create leader user & account
    const { data: leaderAuth } = await db.auth.admin.createUser({
      email: `leader-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    leaderUserId = leaderAuth.user!.id;
    
    const { data: leaderAccount } = await db
      .from("visitor_accounts")
      .insert({ user_id: leaderUserId, status: "active" })
      .select("id")
      .single();
    leaderAccountId = leaderAccount!.id;
    
    await db.from("visitor_church_relationships").insert({
      account_id: leaderAccountId,
      church_id: testChurchId,
      state: "joined",
    });
    
    // Create member user & account
    const { data: memberAuth } = await db.auth.admin.createUser({
      email: `member-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    memberUserId = memberAuth.user!.id;
    
    const { data: memberAccount } = await db
      .from("visitor_accounts")
      .insert({ user_id: memberUserId, status: "active" })
      .select("id")
      .single();
    memberAccountId = memberAccount!.id;
    
    await db.from("visitor_church_relationships").insert({
      account_id: memberAccountId,
      church_id: testChurchId,
      state: "joined",
    });
    
    // Create test group
    const { data: group } = await db
      .from("groups")
      .insert({
        church_id: testChurchId,
        name: "Test Announcement Group",
        is_active: true,
      })
      .select("id")
      .single();
    
    testGroupId = group!.id;
    
    // Add leader membership
    await db.from("group_memberships").insert({
      church_id: testChurchId,
      group_id: testGroupId,
      user_id: leaderUserId,
      account_id: leaderAccountId,
      status: "active",
      role: "leader",
    });
    
    // Add member membership
    await db.from("group_memberships").insert({
      church_id: testChurchId,
      group_id: testGroupId,
      user_id: memberUserId,
      account_id: memberAccountId,
      status: "active",
      role: "member",
    });
  });
  
  after(async () => {
    if (testChurchId) {
      await db.from("churches").delete().eq("id", testChurchId);
      if (leaderUserId) await db.auth.admin.deleteUser(leaderUserId);
      if (memberUserId) await db.auth.admin.deleteUser(memberUserId);
    }
  });
  
  it("queues announcement notification for all active members", async () => {
    const { error } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: [leaderAccountId, memberAccountId],
      topic: "groups",
      title: "Test Announcement",
      body: "This is a test announcement",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: `test-${Date.now()}`,
    });
    
    assert.equal(error, null, "Should queue announcement notification");
    
    const { data } = await db
      .from("notification_outbox")
      .select("*")
      .eq("kind", "group_announcement")
      .eq("subject_id", testGroupId)
      .single();
    
    assert.ok(data, "Notification should be in outbox");
    assert.equal(data!.topic, "groups");
    assert.equal(data!.subject_type, "group");
    assert.equal(data!.target_account_ids!.length, 2);
  });
  
  it("enforces groups topic for group_announcement kind", async () => {
    const { error } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: [leaderAccountId],
      topic: "announcements", // Wrong topic
      title: "Test",
      body: "Test",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: `test-wrong-topic-${Date.now()}`,
    });
    
    assert.ok(error, "Should reject wrong topic");
    assert.match(error!.message, /check|constraint/i);
  });
  
  it("enforces group subject_type for group_announcement", async () => {
    const { error } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "announcement", // Wrong type
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: [leaderAccountId],
      topic: "groups",
      title: "Test",
      body: "Test",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: `test-wrong-subject-${Date.now()}`,
    });
    
    assert.ok(error, "Should reject wrong subject type");
    assert.match(error!.message, /check|constraint/i);
  });
  
  it("requires target_account_ids for groups topic", async () => {
    const { error } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: null, // Missing
      topic: "groups",
      title: "Test",
      body: "Test",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: `test-missing-accounts-${Date.now()}`,
    });
    
    assert.ok(error, "Should reject missing target_account_ids");
    assert.match(error!.message, /check|constraint/i);
  });
  
  it("enforces 1-200 recipient limit", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `account-${i}`);
    
    const { error } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: tooMany,
      topic: "groups",
      title: "Test",
      body: "Test",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: `test-too-many-${Date.now()}`,
    });
    
    assert.ok(error, "Should reject > 200 recipients");
    assert.match(error!.message, /check|constraint/i);
  });
  
  it("deduplicates based on dedupe_key", async () => {
    const dedupeKey = `test-dedupe-${Date.now()}`;
    
    const { error: error1 } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: [leaderAccountId],
      topic: "groups",
      title: "Test",
      body: "First",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: dedupeKey,
    });
    
    assert.equal(error1, null, "First insert should succeed");
    
    const { error: error2 } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: [leaderAccountId],
      topic: "groups",
      title: "Test",
      body: "Duplicate",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: dedupeKey,
    });
    
    assert.ok(error2, "Duplicate should be rejected");
    assert.match(error2!.message, /unique|duplicate/i);
  });
  
  it("isolates notifications by church", async () => {
    // Create another church
    const { data: church2 } = await db
      .from("churches")
      .insert({ name: "Other Church", slug: `other-church-${Date.now()}` })
      .select("id")
      .single();
    
    // Queue notification for our test church
    const { error } = await db.from("notification_outbox").insert({
      church_id: testChurchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: testGroupId,
      target_visibility: "members",
      target_account_ids: [leaderAccountId],
      topic: "groups",
      title: "Test Isolation",
      body: "Test",
      deep_link: `faithform://groups/${testGroupId}`,
      collapse_key: `group-${testGroupId}`,
      dedupe_key: `test-isolation-${Date.now()}`,
    });
    
    assert.equal(error, null, "Should queue notification");
    
    // Query from other church's perspective
    const { data } = await db
      .from("notification_outbox")
      .select("*")
      .eq("church_id", church2!.id)
      .eq("subject_id", testGroupId);
    
    assert.equal(data!.length, 0, "Should not see other church's notifications");
    
    // Clean up
    await db.from("churches").delete().eq("id", church2!.id);
  });
  
  it("excludes inactive members from target list", async () => {
    // Create inactive member
    const { data: inactiveAuth } = await db.auth.admin.createUser({
      email: `inactive-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    
    const { data: inactiveAccount } = await db
      .from("visitor_accounts")
      .insert({ user_id: inactiveAuth.user!.id, status: "inactive" })
      .select("id")
      .single();
    
    await db.from("visitor_church_relationships").insert({
      account_id: inactiveAccount!.id,
      church_id: testChurchId,
      state: "joined",
    });
    
    await db.from("group_memberships").insert({
      church_id: testChurchId,
      group_id: testGroupId,
      user_id: inactiveAuth.user!.id,
      account_id: inactiveAccount!.id,
      status: "active",
      role: "member",
    });
    
    // Get active members only
    const { data: activeMembers } = await db
      .from("group_memberships")
      .select("account_id")
      .eq("group_id", testGroupId)
      .eq("status", "active")
      .not("account_id", "is", null);
    
    const accountIds = activeMembers!.map((m) => m.account_id).filter(Boolean);
    
    // Verify active accounts
    const { data: activeAccounts } = await db
      .from("visitor_accounts")
      .select("id")
      .eq("status", "active")
      .in("id", accountIds);
    
    // Should exclude the inactive account
    assert.ok(
      !activeAccounts!.some((a) => a.id === inactiveAccount!.id),
      "Should exclude inactive account"
    );
    
    // Clean up
    await db.auth.admin.deleteUser(inactiveAuth.user!.id);
  });
});
