#!/usr/bin/env node
/**
 * Configures the Stream Chat app that carries FaithForm group messaging.
 *
 * Run once per environment, and again after changing anything here. Every
 * step is idempotent: it reads what exists and sets it to what this file
 * says. Nothing it prints contains a secret — keys, tokens and credential
 * files are read from the environment and never echoed.
 *
 *   STREAM_CHAT_API_KEY / STREAM_CHAT_API_SECRET   required
 *   NEXT_PUBLIC_SITE_URL                           required (webhook target)
 *   STREAM_CHAT_APN_P8_PATH, STREAM_CHAT_APN_KEY_ID,
 *   STREAM_CHAT_APN_TEAM_ID, STREAM_CHAT_APN_TOPIC,
 *   STREAM_CHAT_APN_DEVELOPMENT=true|false         optional (iOS push)
 *   STREAM_CHAT_FIREBASE_CREDENTIALS_PATH          optional (Android push)
 *   STREAM_CHAT_APN_PROVIDER / _FIREBASE_PROVIDER  optional provider names
 *
 *   node scripts/configure-stream-chat.mjs --dry-run   show the plan only
 *   node scripts/configure-stream-chat.mjs             apply it
 *
 * What it sets, and why:
 *
 *   - Multi-tenancy on. A church is a team; a channel belongs to its church's
 *     team; users belong only to the teams FaithForm gives them. Stream then
 *     refuses cross-church access for every non-admin role, independently of
 *     FaithForm's own checks.
 *   - Auth and permission checks on (never disabled), permissions v2.
 *   - Two channel types, `ff_group` and `ff_dm`, whose grants are derived from
 *     Stream's own `messaging` defaults minus everything that would let a
 *     client change who is in a conversation or create one: membership is
 *     FaithForm's to decide, and the reconciler applies it with the server key.
 *   - `ff_church_staff`, a custom role granted through `teams_role` for the
 *     staff member's own church only: it may read and take part in that
 *     church's *group* conversations and has no grant at all on direct ones.
 *   - The webhook FaithForm verifies (HMAC with the app secret).
 *   - Push v2 with FaithForm's APNs and Firebase providers.
 *   - Upload limits: images and PDFs only, 20 MB.
 */

import { readFileSync } from "node:fs";
import { StreamChat } from "stream-chat";

const DRY_RUN = process.argv.includes("--dry-run");

const apiKey = process.env.STREAM_CHAT_API_KEY?.trim();
const apiSecret = process.env.STREAM_CHAT_API_SECRET?.trim();
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/$/, "");

if (!apiKey || !apiSecret) {
  console.error("Set STREAM_CHAT_API_KEY and STREAM_CHAT_API_SECRET.");
  process.exit(1);
}
if (!siteUrl || !/^https:\/\//.test(siteUrl)) {
  console.error("Set NEXT_PUBLIC_SITE_URL to the HTTPS origin Stream should deliver webhooks to.");
  process.exit(1);
}

const client = new StreamChat(apiKey, apiSecret, { timeout: 15_000 });

const STAFF_ROLE = "ff_church_staff";
const WEBHOOK_URL = `${siteUrl}/api/webhooks/messaging/stream`;
const WEBHOOK_EVENTS = [
  "message.new",
  "message.deleted",
  "message.flagged",
  "user.flagged",
  "member.added",
  "member.removed",
  "member.updated",
  "channel.updated",
  "channel.deleted",
  "channel.truncated",
];

/** Permissions no client role may hold in FaithForm conversations. */
const NEVER_FOR_CLIENTS = new Set([
  "create-channel",
  "delete-channel",
  "update-channel",
  "update-channel-members",
  "update-channel-members-owner",
  "remove-own-channel-membership",
  "recreate-channel",
  "truncate-channel",
  "update-channel-frozen",
  "update-channel-cooldown",
  "ban-channel-member",
  "ban-user",
  "use-frozen-channel",
  "create-restricted-visibility-message",
  "update-message", // editing someone else's message
  "skip-message-moderation",
]);

/** Members may not pin; leaders may. */
const MODERATOR_ONLY = new Set(["pin-message", "delete-message", "delete-attachment", "delete-reaction", "skip-slow-mode", "skip-channel-cooldown"]);

/** Every permission id FaithForm itself names at runtime (lib/messaging/channel-spec.ts). */
const RUNTIME_PERMISSION_IDS = ["create-message", "create-attachment", "upload-attachment", "add-links"];

function log(step, detail = "") {
  console.log(`${DRY_RUN ? "[dry-run] " : ""}${step}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // 1. What permissions exist in this app (so a typo fails here, not in a
  //    member's conversation).
  const { permissions = [] } = await client.listPermissions();
  const known = new Set(permissions.map((p) => p.id));
  const missing = RUNTIME_PERMISSION_IDS.filter((id) => !known.has(id));
  if (missing.length) {
    console.error(`Stream does not know these permission ids used by FaithForm: ${missing.join(", ")}`);
    process.exit(1);
  }

  // 2. App settings.
  const appSettings = {
    multi_tenant_enabled: true,
    permission_version: "v2",
    disable_auth_checks: false,
    disable_permissions_checks: false,
    enforce_unique_usernames: "no",
    async_url_enrich_enabled: true,
    webhook_url: WEBHOOK_URL,
    webhook_events: WEBHOOK_EVENTS,
    push_config: { version: "v2", offline_only: false },
    image_upload_config: {
      allowed_mime_types: ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif"],
      size_limit: 20 * 1024 * 1024,
    },
    file_upload_config: {
      allowed_mime_types: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"],
      size_limit: 20 * 1024 * 1024,
    },
  };
  log("app settings", `multi-tenant, permissions v2, webhook ${WEBHOOK_URL}, push v2, uploads ≤ 20 MB`);
  if (!DRY_RUN) await client.updateAppSettings(appSettings);

  // 3. The staff role.
  const { roles = [] } = await client.listRoles();
  if (!roles.some((role) => role.name === STAFF_ROLE)) {
    log("create role", STAFF_ROLE);
    if (!DRY_RUN) await client.createRole(STAFF_ROLE);
  } else {
    log("role exists", STAFF_ROLE);
  }

  // 4. Channel types, derived from Stream's own `messaging` defaults.
  const messaging = await client.getChannelType("messaging");
  const baseMember = (messaging.grants?.channel_member ?? []).filter((id) => known.has(id));
  const baseModerator = (messaging.grants?.channel_moderator ?? []).filter((id) => known.has(id));

  const member = baseMember.filter((id) => !NEVER_FOR_CLIENTS.has(id) && !MODERATOR_ONLY.has(id));
  const moderator = [...new Set([...member, ...baseModerator.filter((id) => !NEVER_FOR_CLIENTS.has(id))])];
  // Staff act through their team role without joining every group: the same
  // reach as a leader, over the whole church's group conversations.
  const staff = [...new Set([...moderator, "read-channel", "read-channel-members"])].filter((id) => known.has(id));

  const common = {
    typing_events: true,
    read_events: true,
    connect_events: true,
    delivery_events: true,
    custom_events: true,
    search: true,
    reactions: true,
    replies: true,
    quotes: true,
    uploads: true,
    url_enrichment: true,
    mutes: true,
    push_notifications: true,
    polls: true,
    mark_messages_pending: false,
    max_message_length: 4000,
    blocklist: "profanity_en_2020_v1",
    blocklist_behavior: "flag",
    automod: "disabled",
    commands: ["giphy"],
  };

  const types = {
    ff_group: {
      ...common,
      grants: {
        user: [],
        guest: [],
        anonymous: [],
        channel_member: member,
        channel_moderator: moderator,
        [STAFF_ROLE]: staff,
      },
    },
    ff_dm: {
      ...common,
      polls: false,
      grants: {
        user: [],
        guest: [],
        anonymous: [],
        channel_member: member,
        channel_moderator: [],
        // Direct conversations are between their two people. Staff hold no
        // grant here, so no dashboard can read them.
        [STAFF_ROLE]: [],
      },
    },
  };

  for (const [name, config] of Object.entries(types)) {
    let exists = true;
    try {
      await client.getChannelType(name);
    } catch {
      exists = false;
    }
    log(`${exists ? "update" : "create"} channel type ${name}`, `member ${config.grants.channel_member.length} grants, staff ${config.grants[STAFF_ROLE].length}`);
    if (DRY_RUN) continue;
    if (!exists) {
      await client.createChannelType({ name, ...config });
    } else {
      await client.updateChannelType(name, config);
    }
  }

  // 5. Push providers (v2).
  const apnPath = process.env.STREAM_CHAT_APN_P8_PATH?.trim();
  if (apnPath) {
    const name = process.env.STREAM_CHAT_APN_PROVIDER?.trim() || "faithform-apn";
    log("push provider (APNs)", name);
    if (!DRY_RUN) {
      await client.upsertPushProvider({
        name,
        type: "apn",
        apn_auth_type: "token",
        apn_auth_key: readFileSync(apnPath, "utf8"),
        apn_key_id: process.env.STREAM_CHAT_APN_KEY_ID,
        apn_team_id: process.env.STREAM_CHAT_APN_TEAM_ID,
        apn_topic: process.env.STREAM_CHAT_APN_TOPIC,
        apn_development: process.env.STREAM_CHAT_APN_DEVELOPMENT === "true",
      });
    }
  } else {
    log("push provider (APNs)", "skipped: STREAM_CHAT_APN_P8_PATH not set");
  }

  const firebasePath = process.env.STREAM_CHAT_FIREBASE_CREDENTIALS_PATH?.trim();
  if (firebasePath) {
    const name = process.env.STREAM_CHAT_FIREBASE_PROVIDER?.trim() || "faithform-firebase";
    log("push provider (Firebase)", name);
    if (!DRY_RUN) {
      await client.upsertPushProvider({
        name,
        type: "firebase",
        firebase_credentials: readFileSync(firebasePath, "utf8"),
      });
    }
  } else {
    log("push provider (Firebase)", "skipped: STREAM_CHAT_FIREBASE_CREDENTIALS_PATH not set");
  }

  // 6. Read back what matters most and say so plainly.
  if (!DRY_RUN) {
    const { app } = await client.getAppSettings();
    const ok = app.multi_tenant_enabled === true && app.disable_auth_checks !== true && app.disable_permissions_checks !== true;
    if (!ok) {
      console.error("Stream app settings did not take effect: multi-tenancy or auth/permission checks are not as required.");
      process.exit(1);
    }
    const dm = await client.getChannelType("ff_dm");
    if ((dm.grants?.[STAFF_ROLE] ?? []).length > 0 || (dm.grants?.user ?? []).includes("create-channel")) {
      console.error("ff_dm grants are wider than FaithForm allows.");
      process.exit(1);
    }
  }
  log("done");
}

main().catch((error) => {
  // The SDK's message can echo a request; print only its kind and status.
  const status = error?.response?.status ?? error?.status ?? "unknown";
  console.error(`Stream configuration failed (status ${status}). Check the key, secret and plan features, then run again.`);
  process.exit(1);
});
