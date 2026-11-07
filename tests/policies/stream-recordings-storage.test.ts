/**
 * Test stream-recordings storage RLS (migration 0146).
 * Security review: verify private bucket access, signed URL isolation, service_role-only.
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("stream-recordings storage RLS", () => {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let testChurch1: string;
  let testChurch2: string;
  let testUser: { id: string; email: string; client: SupabaseClient };
  let testFilePath1: string;
  let testFilePath2: string;

  before(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      console.warn("⚠️  Skipping stream-recordings storage tests: Supabase env vars not set");
      console.warn("   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to run these tests");
      return;
    }
    admin = createAdminClient();
    // Create test churches
    const { data: church1 } = await admin.from("churches").insert({
      name: "Test Storage Church 1",
      slug: `test-storage-church-1-${Date.now()}`,
    }).select("id").single();
    testChurch1 = church1!.id;

    const { data: church2 } = await admin.from("churches").insert({
      name: "Test Storage Church 2",
      slug: `test-storage-church-2-${Date.now()}`,
    }).select("id").single();
    testChurch2 = church2!.id;

    // Create test user
    const email = `test-storage-${Date.now()}@example.com`;
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

    // Upload test files as service_role (should succeed)
    testFilePath1 = `${testChurch1}/test-recording-${Date.now()}.mp4`;
    testFilePath2 = `${testChurch2}/test-recording-${Date.now()}.mp4`;

    const testContent = new Uint8Array([0x00, 0x00, 0x00, 0x20]); // Minimal valid MP4 header

    const { error: upload1Error } = await admin.storage
      .from("stream-recordings")
      .upload(testFilePath1, testContent, { contentType: "video/mp4" });
    assert.equal(upload1Error, null, "Service role should upload successfully");

    const { error: upload2Error } = await admin.storage
      .from("stream-recordings")
      .upload(testFilePath2, testContent, { contentType: "video/mp4" });
    assert.equal(upload2Error, null, "Service role should upload successfully");
  });

  after(async () => {
    if (!admin) return;
    // Clean up files
    if (testFilePath1) {
      await admin.storage.from("stream-recordings").remove([testFilePath1]);
    }
    if (testFilePath2) {
      await admin.storage.from("stream-recordings").remove([testFilePath2]);
    }

    // Clean up user and churches
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

  it("denies direct authenticated user access to list files", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin || !testUser) return;
    const { data, error } = await testUser.client.storage
      .from("stream-recordings")
      .list();

    // Should fail or return empty due to RLS
    assert.ok(error || !data || data.length === 0, "Authenticated user should not list bucket contents");
  });

  it("denies direct authenticated user download", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin || !testUser) return;
    const { data, error } = await testUser.client.storage
      .from("stream-recordings")
      .download(testFilePath1);

    assert.ok(error, "Authenticated user should not download directly");
  });

  it("denies direct authenticated user upload", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin || !testUser) return;
    const userPath = `${testChurch1}/user-upload-${Date.now()}.mp4`;
    const testContent = new Uint8Array([0x00, 0x00, 0x00, 0x20]);

    const { error } = await testUser.client.storage
      .from("stream-recordings")
      .upload(userPath, testContent, { contentType: "video/mp4" });

    assert.ok(error, "Authenticated user should not upload directly");

    // Clean up if somehow succeeded
    await admin.storage.from("stream-recordings").remove([userPath]);
  });

  it("allows service_role to create signed URLs and access via them", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin) return;
    // Create signed URL (5 minute expiry)
    const { data: signedData, error: signedError } = await admin.storage
      .from("stream-recordings")
      .createSignedUrl(testFilePath1, 300);

    assert.equal(signedError, null, "Service role should create signed URL");
    assert.ok(signedData?.signedUrl, "Should return signed URL");

    // Fetch via signed URL (unauthenticated request)
    const response = await fetch(signedData!.signedUrl);
    assert.ok(response.ok, "Signed URL should allow download");
  });

  it("isolates church paths via signed URLs", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin) return;
    // Create signed URL for church 1 file
    const { data: signed1 } = await admin.storage
      .from("stream-recordings")
      .createSignedUrl(testFilePath1, 300);

    // Create signed URL for church 2 file
    const { data: signed2 } = await admin.storage
      .from("stream-recordings")
      .createSignedUrl(testFilePath2, 300);

    assert.ok(signed1?.signedUrl, "Should create signed URL for church 1");
    assert.ok(signed2?.signedUrl, "Should create signed URL for church 2");

    // Both should work independently (path-based isolation)
    const response1 = await fetch(signed1!.signedUrl);
    const response2 = await fetch(signed2!.signedUrl);

    assert.ok(response1.ok, "Church 1 signed URL should work");
    assert.ok(response2.ok, "Church 2 signed URL should work");

    // Verify church 1 URL cannot access church 2 path by URL manipulation
    const url1 = new URL(signed1!.signedUrl);
    const url2Path = new URL(signed2!.signedUrl).pathname;
    url1.pathname = url2Path;

    const crossResponse = await fetch(url1.toString());
    assert.ok(!crossResponse.ok, "Signed URL should not allow cross-church access via path manipulation");
  });

  it("denies authenticated user deletion", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin || !testUser) return;
    const { error } = await testUser.client.storage
      .from("stream-recordings")
      .remove([testFilePath1]);

    assert.ok(error, "Authenticated user should not delete files");

    // Verify file still exists
    const { data: stillExists } = await admin.storage
      .from("stream-recordings")
      .download(testFilePath1);
    assert.ok(stillExists, "File should still exist after denied deletion");
  });

  it("allows service_role to delete files", { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL }, async () => {
    if (!admin) return;
    const deletePath = `${testChurch1}/delete-test-${Date.now()}.mp4`;
    const testContent = new Uint8Array([0x00, 0x00, 0x20]);

    // Upload test file
    await admin.storage
      .from("stream-recordings")
      .upload(deletePath, testContent, { contentType: "video/mp4" });

    // Delete as service_role
    const { error } = await admin.storage
      .from("stream-recordings")
      .remove([deletePath]);

    assert.equal(error, null, "Service role should delete successfully");

    // Verify deletion
    const { error: downloadError } = await admin.storage
      .from("stream-recordings")
      .download(deletePath);
    assert.ok(downloadError, "File should be deleted");
  });
});

async function createUserClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createAdminClient();
  await client.auth.signInWithPassword({ email, password });
  return client;
}
