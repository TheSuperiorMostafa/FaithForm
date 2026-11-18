import type { SupabaseClient } from "@supabase/supabase-js";

import { createFacebookReelsClient, resolveReelsGraphVersion, type ReelProvider } from "@/lib/integrations/facebook-reels";
import { getFacebookPageAccessToken, refreshFacebookPageToken } from "@/lib/integrations/facebook-token";
import { markIntegrationNeedsReconnect } from "@/lib/integrations/tokens";
import { CLIPS_BUCKET } from "@/lib/sermon-media/clips";
import { logSermonMedia } from "@/lib/sermon-media/jobs";
import {
  advanceReelPost,
  startReelPost,
  type ReelPostInsert,
  type ReelPostRepo,
  type ReelPostRow,
  type ReelPublisherDeps,
} from "@/lib/sermon-media/reel-publisher";

/**
 * Production wiring for Facebook Reel posts: Supabase rows, the church's
 * existing Page connection and tokens, and the private render in storage.
 *
 * The Page a post goes to is fixed when staff click Post. If the church has
 * since disconnected or connected a different Page, the post stops with
 * `page_changed` rather than going to whichever Page is connected now.
 */
const COLUMNS =
  "id, church_id, render_id, page_id, caption, status, provider_video_id, provider_post_id, permalink, last_error_code, last_error, check_attempts, finish_attempts, finish_requested_at, posted_at, last_checked_at";

export function supabaseReelRepo(db: SupabaseClient, churchId: string): ReelPostRepo {
  return {
    async load(postId) {
      const { data } = await db.from("facebook_reel_posts").select(COLUMNS).eq("id", postId).eq("church_id", churchId).maybeSingle();
      return (data as ReelPostRow | null) ?? null;
    },
    async update(postId, patch, expectedStatus) {
      const { data } = await db
        .from("facebook_reel_posts")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", postId)
        .eq("church_id", churchId)
        .eq("status", expectedStatus)
        .select(COLUMNS)
        .maybeSingle();
      return (data as ReelPostRow | null) ?? null;
    },
    async acquireStepLock(postId, seconds) {
      const now = new Date();
      const { data } = await db
        .from("facebook_reel_posts")
        .update({ step_lock_until: new Date(now.getTime() + seconds * 1000).toISOString() })
        .eq("id", postId)
        .eq("church_id", churchId)
        .or(`step_lock_until.is.null,step_lock_until.lt.${now.toISOString()}`)
        .select("id")
        .maybeSingle();
      return Boolean(data);
    },
    async releaseStepLock(postId) {
      await db.from("facebook_reel_posts").update({ step_lock_until: null }).eq("id", postId).eq("church_id", churchId);
    },
    async insertOnce(input) {
      const { data, error } = await db.from("facebook_reel_posts").insert(input).select(COLUMNS).maybeSingle();
      if (!error && data) return { row: data as ReelPostRow, created: true };
      // Unique (render, page) while not failed: a double-click or retry lands here.
      const { data: existing } = await db
        .from("facebook_reel_posts")
        .select(COLUMNS)
        .eq("render_id", input.render_id)
        .eq("page_id", input.page_id)
        .neq("status", "failed")
        .maybeSingle();
      if (!existing) throw new Error(`Could not record the post: ${error?.message ?? "unknown"}`);
      return { row: existing as ReelPostRow, created: false };
    },
  };
}

class PageChangedError extends Error {}

async function providerFor(churchId: string, pageId: string, db: SupabaseClient): Promise<ReelProvider> {
  const connection = await getFacebookPageAccessToken(churchId, db);
  if (connection.pageId !== pageId) throw new PageChangedError("A different Facebook Page is connected now.");
  return createFacebookReelsClient({
    fetch,
    graphVersion: resolveReelsGraphVersion(process.env),
    pageId,
    pageToken: connection.token,
  });
}

async function depsFor(db: SupabaseClient, churchId: string, pageId: string, renderPath: string, renderSize: number): Promise<ReelPublisherDeps> {
  return {
    repo: supabaseReelRepo(db, churchId),
    provider: await providerFor(churchId, pageId, db),
    refreshProvider: async () => {
      const token = await refreshFacebookPageToken(churchId, db);
      if (!token) return null;
      return createFacebookReelsClient({ fetch, graphVersion: resolveReelsGraphVersion(process.env), pageId, pageToken: token });
    },
    markReconnectRequired: async (reason) => {
      await markIntegrationNeedsReconnect(churchId, "facebook", reason.slice(0, 200), db);
    },
    openRender: async () => {
      const { data, error } = await db.storage.from(CLIPS_BUCKET).createSignedUrl(renderPath, 15 * 60);
      if (error || !data) throw new Error("The rendered clip could not be opened.");
      const response = await fetch(data.signedUrl);
      if (!response.ok || !response.body) throw new Error("The rendered clip could not be read.");
      return { stream: response.body, size: renderSize };
    },
    now: () => new Date(),
  };
}

async function renderFor(db: SupabaseClient, renderId: string): Promise<{ path: string; size: number } | null> {
  const { data } = await db.from("sermon_clip_renders").select("storage_path, byte_size").eq("id", renderId).maybeSingle();
  if (!data?.storage_path || !data.byte_size) return null;
  return { path: data.storage_path, size: Number(data.byte_size) };
}

async function failPageChanged(db: SupabaseClient, churchId: string, postId: string): Promise<void> {
  await db
    .from("facebook_reel_posts")
    .update({
      status: "failed",
      last_error_code: "page_changed",
      last_error: "The connected Facebook Page changed or was disconnected. Reconnect the Page and post again.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .eq("church_id", churchId)
    .in("status", ["starting"]);
}

export async function publishReel(db: SupabaseClient, input: ReelPostInsert, render: { path: string; size: number }) {
  try {
    const deps = await depsFor(db, input.church_id, input.page_id, render.path, render.size);
    return await startReelPost(deps, input);
  } catch (error) {
    if (error instanceof PageChangedError) {
      return { pageChanged: true as const };
    }
    throw error;
  }
}

export async function advanceReel(db: SupabaseClient, post: { id: string; church_id: string; page_id: string; render_id: string; status: string }) {
  const render = await renderFor(db, post.render_id);
  if (!render) return null;
  try {
    const deps = await depsFor(db, post.church_id, post.page_id, render.path, render.size);
    return await advanceReelPost(deps, post.id);
  } catch (error) {
    if (error instanceof PageChangedError || (error instanceof Error && /not connected/i.test(error.message))) {
      // Before Meta has a video there is nothing to reconcile; after, keep
      // checking is impossible without the Page's token, so say so plainly.
      if (post.status === "starting") await failPageChanged(db, post.church_id, post.id);
      else {
        await db.from("facebook_reel_posts").update({
          last_error_code: "page_changed",
          last_error: "We can't check this post because the Facebook Page was disconnected or changed.",
          updated_at: new Date().toISOString(),
        }).eq("id", post.id);
      }
      return null;
    }
    throw error;
  }
}

/** Cron: move every open post forward. Locks make this safe alongside requests. */
export async function reconcileOpenReelPosts(db: SupabaseClient, limit = 20): Promise<{ checked: number; posted: number }> {
  const { data } = await db
    .from("facebook_reel_posts")
    .select("id, church_id, page_id, render_id, status, updated_at")
    .in("status", ["starting", "uploading", "finishing", "processing", "needs_check"])
    .lt("updated_at", new Date(Date.now() - 30_000).toISOString())
    .order("updated_at", { ascending: true })
    .limit(limit);
  let posted = 0;
  for (const post of data ?? []) {
    try {
      const result = await advanceReel(db, post);
      if (result?.outcome === "posted") posted += 1;
    } catch (error) {
      logSermonMedia("reel_reconcile_failed", { postId: post.id, error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    }
  }
  return { checked: data?.length ?? 0, posted };
}
