import { createHmac, timingSafeEqual } from "node:crypto";

import { StreamChat } from "stream-chat";

import { readMessagingConfig, type MessagingConfig } from "@/lib/messaging/config";
import { apnProviderName, ensureChatPushConfigured } from "@/lib/messaging/push-configuration";
import { SYSTEM_CHAT_USER_ID, cidOf, type ChannelType } from "@/lib/messaging/ids";
import {
  ChatProviderError,
  type ChannelConfigOverrides,
  type ChannelData,
  type ChannelMember,
  type ChannelRole,
  type ChatDevice,
  type ChatMessage,
  type ChatProvider,
  type ChatUserProfile,
  type PushPreferenceInput,
} from "@/lib/messaging/provider";

/**
 * The Stream Chat implementation of `ChatProvider`.
 *
 * Server-side only: it holds the app secret. Nothing here is reachable from a
 * browser bundle (it imports `node:crypto`), and no method returns the secret
 * or anything signed with it except a user token for that user.
 *
 * Errors are classified, never passed through: a provider message can echo a
 * request, so callers receive a category and a status, and nothing is logged
 * here at all.
 */

type StreamError = { status?: number; code?: number; response?: { status?: number } };

function classify(error: unknown): ChatProviderError {
  if (error instanceof ChatProviderError) return error;
  const e = error as StreamError & { message?: string };
  const status = e?.response?.status ?? e?.status ?? null;
  const message = typeof e?.message === "string" ? e.message : "";

  if (status === 404 || /does not exist|not found|can't find/i.test(message)) {
    return new ChatProviderError("not_found", "not found", status ?? 404);
  }
  if (status === 401 || status === 403) {
    return new ChatProviderError("auth", "credentials refused", status);
  }
  if (status === 400) {
    return new ChatProviderError("invalid", "request refused", status);
  }
  // 429, 5xx, timeouts, DNS, reset connections: all worth another try.
  return new ChatProviderError("unavailable", "provider unavailable", status);
}

function toChatMessage(message: unknown): ChatMessage {
  const raw = message as Record<string, unknown> & {
    user?: { id?: string; name?: string };
    attachments?: unknown[];
  };
  return {
    id: String(raw.id),
    cid: String(raw.cid ?? ""),
    text: typeof raw.text === "string" ? raw.text : "",
    authorChatUserId: raw.user?.id ?? null,
    authorName: raw.user?.name ?? null,
    createdAt: String(raw.created_at ?? new Date().toISOString()),
    parentId: typeof raw.parent_id === "string" ? raw.parent_id : null,
    deleted: raw.type === "deleted" || Boolean(raw.deleted_at),
    attachmentCount: Array.isArray(raw.attachments) ? raw.attachments.length : 0,
  };
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw classify(error);
  }
}

/** Swallows "not found" where absence is the goal. */
async function tolerateMissing(operation: () => Promise<unknown>): Promise<void> {
  try {
    await call(operation);
  } catch (error) {
    if (error instanceof ChatProviderError && error.category === "not_found") return;
    throw error;
  }
}

export class StreamChatProvider implements ChatProvider {
  readonly appKey: string;
  private readonly client: StreamChat;
  private readonly secret: string;
  private systemUserReady: Promise<void> | null = null;

  constructor(config: MessagingConfig) {
    this.appKey = config.apiKey;
    this.secret = config.apiSecret;
    this.client = new StreamChat(config.apiKey, config.apiSecret, {
      // A reconcile or a request handler waits at most this long for Stream.
      timeout: 8000,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  createUserToken(chatUserId: string, expiresAtSeconds: number): string {
    return this.client.createToken(chatUserId, expiresAtSeconds, Math.floor(Date.now() / 1000) - 5);
  }

  private ensureSystemUser(): Promise<void> {
    this.systemUserReady ??= call(() =>
      this.client.upsertUsers([{ id: SYSTEM_CHAT_USER_ID, name: "FaithForm", role: "user" }]),
    ).then(
      () => undefined,
      (error) => {
        this.systemUserReady = null;
        throw error;
      },
    );
    return this.systemUserReady;
  }

  async upsertUsers(users: ChatUserProfile[]): Promise<void> {
    for (let i = 0; i < users.length; i += 100) {
      const batch = users.slice(i, i + 100).map((user) => ({
        id: user.chatUserId,
        name: user.name,
        image: user.image ?? undefined,
        role: "user",
        teams: user.teams,
        teams_role: user.teamRoles,
        ff_staff: user.isStaff,
      }));
      await call(() => this.client.upsertUsers(batch));
    }
  }

  async revokeUserTokens(chatUserId: string, before: Date): Promise<void> {
    await tolerateMissing(() => this.client.revokeUserToken(chatUserId, before));
  }

  async deleteUsers(chatUserIds: string[]): Promise<void> {
    if (chatUserIds.length === 0) return;
    // Hard: the person asked to be deleted, and what they wrote goes with them.
    await tolerateMissing(() =>
      this.client.deleteUsers(chatUserIds, { user: "hard", messages: "hard", conversations: "hard" }),
    );
  }

  async ensureChannel(
    type: ChannelType,
    id: string,
    data: ChannelData,
    options: { frozen: boolean; configOverrides: ChannelConfigOverrides | null },
  ): Promise<void> {
    await this.ensureSystemUser();
    const channel = this.client.channel(type, id, {
      name: data.name,
      team: data.team,
      created_by_id: SYSTEM_CHAT_USER_ID,
    } as never);
    // `create` is get-or-create: an existing channel is returned untouched,
    // which is why the data is then set explicitly.
    await call(() => channel.create());

    const set: Record<string, unknown> = {
      name: data.name,
      frozen: options.frozen,
      ...data.custom,
    };
    if (data.image) set.image = data.image;
    if (options.configOverrides) {
      set.config_overrides = {
        grants: options.configOverrides.grants,
        commands: options.configOverrides.commands,
        ...(options.configOverrides.blocklist
          ? { blocklist: options.configOverrides.blocklist, blocklist_behavior: "flag" }
          : {}),
      };
    }
    await call(() =>
      channel.updatePartial({
        set: set as never,
        ...(data.image ? {} : { unset: ["image"] as never }),
      }),
    );
  }

  async deleteChannel(type: ChannelType, id: string): Promise<void> {
    await tolerateMissing(() => this.client.channel(type, id).delete({ hard_delete: true }));
  }

  async channelExists(type: ChannelType, id: string): Promise<boolean> {
    const channels = await call(() =>
      this.client.queryChannels({ cid: cidOf(type, id) } as never, {}, { limit: 1, state: false, watch: false } as never),
    );
    return channels.length > 0;
  }

  async listMembers(type: ChannelType, id: string): Promise<ChannelMember[]> {
    const channel = this.client.channel(type, id);
    const members: ChannelMember[] = [];
    const limit = 100;
    for (let offset = 0; offset < 10_000; offset += limit) {
      const page = await call(() => channel.queryMembers({}, { created_at: 1 } as never, { limit, offset }));
      for (const member of page.members ?? []) {
        const userId = member.user_id ?? member.user?.id;
        if (!userId) continue;
        members.push({
          chatUserId: userId,
          channelRole: (member.channel_role as string) ?? "channel_member",
          banned: Boolean(member.banned),
        });
      }
      if ((page.members ?? []).length < limit) break;
    }
    return members;
  }

  async addMembers(
    type: ChannelType,
    id: string,
    members: { chatUserId: string; channelRole: ChannelRole }[],
  ): Promise<void> {
    const channel = this.client.channel(type, id);
    for (let i = 0; i < members.length; i += 100) {
      const batch = members
        .slice(i, i + 100)
        .map((member) => ({ user_id: member.chatUserId, channel_role: member.channelRole }));
      // No system message: a member joining is FaithForm's news to tell.
      await call(() => channel.addMembers(batch as never, undefined, { hide_history: false } as never));
    }
  }

  async removeMembers(type: ChannelType, id: string, chatUserIds: string[]): Promise<void> {
    const channel = this.client.channel(type, id);
    for (let i = 0; i < chatUserIds.length; i += 100) {
      await tolerateMissing(() => channel.removeMembers(chatUserIds.slice(i, i + 100)));
    }
  }

  async setMemberRoles(
    type: ChannelType,
    id: string,
    members: { chatUserId: string; channelRole: ChannelRole }[],
  ): Promise<void> {
    if (members.length === 0) return;
    const channel = this.client.channel(type, id);
    await call(() =>
      channel.assignRoles(members.map((m) => ({ user_id: m.chatUserId, channel_role: m.channelRole })) as never),
    );
  }

  async banInChannel(
    type: ChannelType,
    id: string,
    chatUserId: string,
    options: { reason: string | null; timeoutMinutes: number | null },
  ): Promise<void> {
    await this.ensureSystemUser();
    await call(() =>
      this.client.channel(type, id).banUser(chatUserId, {
        banned_by_id: SYSTEM_CHAT_USER_ID,
        ...(options.reason ? { reason: options.reason.slice(0, 250) } : {}),
        ...(options.timeoutMinutes ? { timeout: Math.max(1, Math.ceil(options.timeoutMinutes)) } : {}),
      }),
    );
  }

  async unbanInChannel(type: ChannelType, id: string, chatUserId: string): Promise<void> {
    await tolerateMissing(() => this.client.channel(type, id).unbanUser(chatUserId));
  }

  async getMessage(messageId: string): Promise<ChatMessage | null> {
    try {
      const { message } = await call(() => this.client.getMessage(messageId, { show_deleted_message: true }));
      if (!message) return null;
      return toChatMessage(message);
    } catch (error) {
      if (error instanceof ChatProviderError && error.category === "not_found") return null;
      throw error;
    }
  }

  async getMessagesAround(type: ChannelType, id: string, messageId: string, limit: number): Promise<ChatMessage[]> {
    try {
      const state = await call(() =>
        this.client.channel(type, id).query({
          state: true,
          watch: false,
          presence: false,
          messages: { limit: Math.min(Math.max(limit, 1), 25), id_around: messageId },
        } as never),
      );
      const messages = ((state as unknown as { messages?: unknown[] }).messages ?? []).map(toChatMessage);
      return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (error) {
      if (error instanceof ChatProviderError && error.category === "not_found") return [];
      throw error;
    }
  }

  async deleteMessage(messageId: string, options: { hard: boolean }): Promise<void> {
    await tolerateMissing(() => this.client.deleteMessage(messageId, { hardDelete: options.hard }));
  }

  async flagMessage(messageId: string, reporterChatUserId: string, reason: string): Promise<void> {
    try {
      await call(() => this.client.flagMessage(messageId, { user_id: reporterChatUserId, reason }));
    } catch (error) {
      // Flagging twice is refused by Stream; the FaithForm report is the record.
      if (error instanceof ChatProviderError && (error.category === "invalid" || error.category === "not_found")) return;
      throw error;
    }
  }

  async blockUser(blockerChatUserId: string, blockedChatUserId: string): Promise<void> {
    try {
      await call(() => this.client.blockUser(blockedChatUserId, blockerChatUserId));
    } catch (error) {
      if (error instanceof ChatProviderError && error.category === "invalid") return;
      throw error;
    }
  }

  async unblockUser(blockerChatUserId: string, blockedChatUserId: string): Promise<void> {
    try {
      await call(() => this.client.unBlockUser(blockedChatUserId, blockerChatUserId));
    } catch (error) {
      if (error instanceof ChatProviderError && (error.category === "invalid" || error.category === "not_found")) return;
      throw error;
    }
  }

  async listBlockedUsers(blockerChatUserId: string): Promise<string[]> {
    const response = await call(() => this.client.getBlockedUsers(blockerChatUserId));
    const blocks = (response as unknown as { blocks?: { blocked_user_id?: string }[] }).blocks ?? [];
    return blocks.map((block) => block.blocked_user_id).filter((id): id is string => Boolean(id));
  }

  async muteChannel(type: ChannelType, id: string, chatUserId: string): Promise<void> {
    await call(() => this.client.channel(type, id).mute({ user_id: chatUserId }));
  }

  async unmuteChannel(type: ChannelType, id: string, chatUserId: string): Promise<void> {
    await tolerateMissing(() => this.client.channel(type, id).unmute({ user_id: chatUserId }));
  }

  async listDevices(chatUserId: string): Promise<ChatDevice[]> {
    try {
      const response = await call(() => this.client.getDevices(chatUserId));
      return (response.devices ?? []).map((device) => ({
        token: device.id,
        provider: device.push_provider === "apn" ? "apn" : "firebase",
        apnsEnvironment: device.push_provider_name?.endsWith("-development") ? "development" : "production",
      }));
    } catch (error) {
      if (error instanceof ChatProviderError && error.category === "not_found") return [];
      throw error;
    }
  }

  async addDevice(chatUserId: string, device: ChatDevice): Promise<void> {
    const config = readMessagingConfig();
    if (device.provider === "apn") await ensureChatPushConfigured();
    const providerName =
      device.provider === "apn" ? apnProviderName(config?.apnProviderName ?? "faithform-apn", device.apnsEnvironment) : config?.firebaseProviderName;
    await call(() => this.client.addDevice(device.token, device.provider, chatUserId, providerName));
  }

  async removeDevice(chatUserId: string, token: string): Promise<void> {
    await tolerateMissing(() => this.client.removeDevice(token, chatUserId));
  }

  async setPushPreferences(preferences: PushPreferenceInput[]): Promise<void> {
    for (let i = 0; i < preferences.length; i += 100) {
      const batch = preferences.slice(i, i + 100).map((preference) => ({
        user_id: preference.chatUserId,
        ...(preference.channelCid ? { channel_cid: preference.channelCid } : {}),
        ...(preference.level ? { chat_level: preference.level } : {}),
        ...(preference.disabledUntil ? { disabled_until: preference.disabledUntil } : {}),
        ...(preference.removeDisable ? { remove_disable: true } : {}),
      }));
      await call(() => this.client.setPushPreferences(batch));
    }
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
    const expected = createHmac("sha256", this.secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature.toLowerCase(), "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

let cached: { key: string; provider: StreamChatProvider } | null = null;

/**
 * The process-wide provider, or null when chat is not configured. One client
 * per process: the server SDK is stateless over HTTP, and building one per
 * request would only add allocation.
 */
export function getChatProvider(): ChatProvider | null {
  const config = readMessagingConfig();
  if (!config) return null;
  const key = `${config.apiKey}:${config.baseUrl ?? ""}`;
  if (cached?.key !== key) cached = { key, provider: new StreamChatProvider(config) };
  return cached.provider;
}
