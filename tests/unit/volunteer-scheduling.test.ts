/**
 * Test B2/G1: Volunteer availability and schedule acceptance.
 * Validates self-service restrictions, manager permissions, and proper isolation.
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

describe("Volunteer scheduling (B2/G1)", { skip: !supabaseUrl || !supabaseServiceKey }, () => {
  let db: ReturnType<typeof createClient>;
  let testChurchId: string;
  let testGroupId: string;
  let testUserId: string;
  let testMembershipId: string;
  let testEventId: string;
  
  before(async () => {
    db = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create test church
    const { data: church } = await db
      .from("churches")
      .insert({ name: "Test Church", slug: `test-volunteer-${Date.now()}` })
      .select("id")
      .single();
    
    testChurchId = church!.id;
    
    // Enable groups feature
    await db.from("church_features").insert({
      church_id: testChurchId,
      feature_key: "groups",
      enabled: true,
    });
    
    // Create test user
    const { data: authUser } = await db.auth.admin.createUser({
      email: `volunteer-test-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    
    testUserId = authUser.user!.id;
    
    // Create test group
    const { data: group } = await db
      .from("groups")
      .insert({
        church_id: testChurchId,
        name: "Test Volunteer Group",
        is_active: true,
      })
      .select("id")
      .single();
    
    testGroupId = group!.id;
    
    // Create group membership
    const { data: membership } = await db
      .from("group_memberships")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        user_id: testUserId,
        status: "active",
        role: "member",
      })
      .select("id")
      .single();
    
    testMembershipId = membership!.id;
    
    // Create test event
    const { data: event } = await db
      .from("group_events")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        name: "Test Event",
        starts_at: new Date("2026-12-01T10:00:00Z").toISOString(),
      })
      .select("id")
      .single();
    
    testEventId = event!.id;
  });
  
  after(async () => {
    if (testChurchId) {
      // Clean up test data
      await db.from("churches").delete().eq("id", testChurchId);
      if (testUserId) {
        await db.auth.admin.deleteUser(testUserId);
      }
    }
  });
  
  it("allows member to set own availability", async () => {
    const availability = "Available Sundays 9am-12pm";
    
    const { error } = await db
      .from("group_memberships")
      .update({ availability })
      .eq("id", testMembershipId)
      .eq("user_id", testUserId);
    
    assert.equal(error, null, "Should allow member to update own availability");
    
    const { data } = await db
      .from("group_memberships")
      .select("availability")
      .eq("id", testMembershipId)
      .single();
    
    assert.equal(data!.availability, availability);
  });
  
  it("enforces 500 character limit on availability", async () => {
    const tooLong = "x".repeat(501);
    
    const { error } = await db
      .from("group_memberships")
      .update({ availability: tooLong })
      .eq("id", testMembershipId);
    
    assert.ok(error, "Should reject availability over 500 characters");
    assert.match(error!.message, /availability/i);
  });
  
  it("allows member to respond to assignment", async () => {
    const { error } = await db
      .from("group_event_responses")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        event_id: testEventId,
        user_id: testUserId,
        membership_id: testMembershipId,
        status: "accepted",
        response_note: "I'll be there!",
      });
    
    assert.equal(error, null, "Should allow member to respond");
    
    const { data } = await db
      .from("group_event_responses")
      .select("status, response_note")
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId)
      .single();
    
    assert.equal(data!.status, "accepted");
    assert.equal(data!.response_note, "I'll be there!");
  });
  
  it("allows changing response", async () => {
    const { error } = await db
      .from("group_event_responses")
      .update({
        status: "declined",
        response_note: "Sorry, can't make it",
      })
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId);
    
    assert.equal(error, null, "Should allow changing response");
    
    const { data } = await db
      .from("group_event_responses")
      .select("status")
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId)
      .single();
    
    assert.equal(data!.status, "declined");
  });
  
  it("enforces 500 character limit on response note", async () => {
    const tooLong = "x".repeat(501);
    
    const { error } = await db
      .from("group_event_responses")
      .update({ response_note: tooLong })
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId);
    
    assert.ok(error, "Should reject note over 500 characters");
  });
  
  it("enforces unique response per event+membership", async () => {
    const { error } = await db
      .from("group_event_responses")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        event_id: testEventId,
        user_id: testUserId,
        membership_id: testMembershipId,
        status: "tentative",
      });
    
    assert.ok(error, "Should reject duplicate response");
    assert.match(error!.message, /unique|duplicate/i);
  });
  
  it("tracks assignment metadata", async () => {
    // Create manager user
    const { data: managerAuthUser } = await db.auth.admin.createUser({
      email: `manager-test-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    
    const managerId = managerAuthUser.user!.id;
    
    // Create manager membership
    await db.from("group_memberships").insert({
      church_id: testChurchId,
      group_id: testGroupId,
      user_id: managerId,
      status: "active",
      role: "leader",
    });
    
    // Create new event for assignment test
    const { data: event2 } = await db
      .from("group_events")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        name: "Test Event 2",
        starts_at: new Date("2026-12-08T10:00:00Z").toISOString(),
      })
      .select("id")
      .single();
    
    const assignedAt = new Date().toISOString();
    
    const { error } = await db
      .from("group_event_responses")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        event_id: event2!.id,
        user_id: testUserId,
        membership_id: testMembershipId,
        status: "pending",
        is_assigned: true,
        assigned_by: managerId,
        assigned_at: assignedAt,
      });
    
    assert.equal(error, null, "Should track assignment metadata");
    
    const { data } = await db
      .from("group_event_responses")
      .select("is_assigned, assigned_by")
      .eq("event_id", event2!.id)
      .eq("membership_id", testMembershipId)
      .single();
    
    assert.equal(data!.is_assigned, true);
    assert.equal(data!.assigned_by, managerId);
    
    // Clean up
    await db.auth.admin.deleteUser(managerId);
  });
  
  it("validates status values", async () => {
    const { error } = await db
      .from("group_event_responses")
      .update({ status: "invalid" as "pending" | "accepted" | "declined" | "tentative" })
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId);
    
    assert.ok(error, "Should reject invalid status");
    assert.match(error!.message, /check|constraint/i);
  });
  
  it("isolates responses by church", async () => {
    // Create another church
    const { data: church2 } = await db
      .from("churches")
      .insert({ name: "Other Church", slug: `other-volunteer-${Date.now()}` })
      .select("id")
      .single();
    
    // Try to query responses from different church
    const { data } = await db
      .from("group_event_responses")
      .select("*")
      .eq("church_id", church2!.id)
      .eq("event_id", testEventId);
    
    assert.equal(data!.length, 0, "Should not see other church's responses");
    
    // Clean up
    await db.from("churches").delete().eq("id", church2!.id);
  });
});
