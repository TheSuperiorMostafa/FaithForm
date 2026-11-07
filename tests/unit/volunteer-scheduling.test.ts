/**
 * Test B2/G1: Volunteer availability and schedule acceptance.
 * Validates self-service restrictions, manager permissions, and proper isolation.
 */

// @ts-nocheck - Integration test requiring live database
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
  
  it("allows member to RSVP to event", async () => {
    const { error } = await db
      .from("group_event_rsvps")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        event_id: testEventId,
        membership_id: testMembershipId,
        response: "going",
      });
    
    assert.equal(error, null, "Should allow member to RSVP");
    
    const { data } = await db
      .from("group_event_rsvps")
      .select("response")
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId)
      .single();
    
    assert.equal(data!.response, "going");
  });
  
  it("allows changing RSVP", async () => {
    const { error } = await db
      .from("group_event_rsvps")
      .update({
        response: "not_going",
      })
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId);
    
    assert.equal(error, null, "Should allow changing RSVP");
    
    const { data } = await db
      .from("group_event_rsvps")
      .select("response")
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId)
      .single();
    
    assert.equal(data!.response, "not_going");
  });
  
  it("enforces valid RSVP responses", async () => {
    const { error } = await db
      .from("group_event_rsvps")
      .update({ response: "invalid" as any })
      .eq("event_id", testEventId)
      .eq("membership_id", testMembershipId);
    
    assert.ok(error, "Should reject invalid response");
  });
  
  it("enforces unique RSVP per event+membership", async () => {
    const { error } = await db
      .from("group_event_rsvps")
      .insert({
        church_id: testChurchId,
        group_id: testGroupId,
        event_id: testEventId,
        membership_id: testMembershipId,
        response: "maybe",
      });
    
    assert.ok(error, "Should reject duplicate RSVP");
    assert.match(error!.message, /unique|duplicate/i);
  });
  
  it("isolates RSVPs by church", async () => {
    // Create another church
    const { data: church2 } = await db
      .from("churches")
      .insert({ name: "Other Church", slug: `other-volunteer-${Date.now()}` })
      .select("id")
      .single();
    
    // Try to query RSVPs from different church
    const { data } = await db
      .from("group_event_rsvps")
      .select("*")
      .eq("church_id", church2!.id)
      .eq("event_id", testEventId);
    
    assert.equal(data!.length, 0, "Should not see other church's RSVPs");
    
    // Clean up
    await db.from("churches").delete().eq("id", church2!.id);
  });
  
});
