import type { ChannelType } from "@/lib/messaging/ids";

/**
 * What FaithForm asks of a chat provider, and nothing more.
 *
 * Deliberately not a pretend-universal chat abstraction: the operations are
 * the ones the reconcilers, the session endpoint and moderation actually
 * perform, named for what FaithForm needs. There is one implementation
 * (`stream-provider.ts`); tests substitute an in-memory one. The domain never
 * imports a provider SDK directly.
 *
 * Every method is safe to repeat. Adding a member who is already a member,
 * deleting a channel that is already gone, blocking twice — all succeed —
 * because the outbox retries and a retry must never be the thing that fails.
 */

export type ChannelRole = "channel_member" | "channel_moderator";

/** What a chat user is told about themselves. Never an email or a phone. */
export type ChatUserProfile = {
  chatUserId: string;
  name: string;
  image: string | null;
  /** Provider tenants (one per church) this person may reach. */
  teams: string[];
  /** Per-tenant role: staff get `ff_church_staff` in their own church. */
  teamRoles: Record<string, string>;
  /** Shown beside the name in chat. */
  isStaff: boolean;
};

export type ChannelData = {
  name: string;
  image: string | null;
  team: string;
  /** FaithForm context the clients and push templates read. */
  custom: Record<string, string>;
};

export type ChannelConfigOverrides = {
  /** Grants per role; a `!` prefix revokes. */
  grants: Record<string, string[]>;
  commands: string[];
  blocklist: string | null;
};

export type ChannelMember = { chatUserId: string; channelRole: ChannelRole | string; banned?: boolean };

export type ChatMessage = {
  id: string;
  cid: string;
  text: string;
  authorChatUserId: string | null;
  authorName: string | null;
  createdAt: string;
  parentId: string | null;
  deleted: boolean;
  attachmentCount: number;
};

export type PushLevel = "all" | "mentions" | "none" | "default";

export type PushPreferenceInput = {
  chatUserId: string;
  channelCid?: string;
  level?: PushLevel;
  /** Set to a far-future instant to switch a person's chat pushes off. */
  disabledUntil?: string;
  removeDisable?: boolean;
};

export type DeviceProvider = "apn" | "firebase";

export type ChatDevice = { token: string; provider: DeviceProvider };

export type ChatProviderErrorCategory =
  /** Retry later: timeouts, 5xx, rate limits. */
  | "unavailable"
  /** The thing is not there. Usually success for a delete. */
  | "not_found"
  /** Our request was wrong. Retrying will not help. */
  | "invalid"
  /** Our credentials were refused. Retrying will not help until an operator acts. */
  | "auth";

export class ChatProviderError extends Error {
  readonly category: ChatProviderErrorCategory;
  readonly status: number | null;

  constructor(category: ChatProviderErrorCategory, message: string, status: number | null = null) {
    super(message);
    this.name = "ChatProviderError";
    this.category = category;
    this.status = status;
  }
}

export interface ChatProvider {
  readonly appKey: string;

  createUserToken(chatUserId: string, expiresAtSeconds: number): string;
  upsertUsers(users: ChatUserProfile[]): Promise<void>;
  /** Invalidates every token issued before `before` (tenancy lost, blocked). */
  revokeUserTokens(chatUserId: string, before: Date): Promise<void>;
  /** Removes a person and what they wrote (account deletion). */
  deleteUsers(chatUserIds: string[]): Promise<void>;

  /** Creates the channel if missing, then brings its data up to date. */
  ensureChannel(
    type: ChannelType,
    id: string,
    data: ChannelData,
    options: { frozen: boolean; configOverrides: ChannelConfigOverrides | null },
  ): Promise<void>;
  deleteChannel(type: ChannelType, id: string): Promise<void>;
  channelExists(type: ChannelType, id: string): Promise<boolean>;

  listMembers(type: ChannelType, id: string): Promise<ChannelMember[]>;
  addMembers(type: ChannelType, id: string, members: { chatUserId: string; channelRole: ChannelRole }[]): Promise<void>;
  removeMembers(type: ChannelType, id: string, chatUserIds: string[]): Promise<void>;
  setMemberRoles(type: ChannelType, id: string, members: { chatUserId: string; channelRole: ChannelRole }[]): Promise<void>;

  banInChannel(
    type: ChannelType,
    id: string,
    chatUserId: string,
    options: { reason: string | null; timeoutMinutes: number | null },
  ): Promise<void>;
  unbanInChannel(type: ChannelType, id: string, chatUserId: string): Promise<void>;

  getMessage(messageId: string): Promise<ChatMessage | null>;
  /**
   * The messages either side of one message, oldest first — for a moderator
   * reviewing a report in a group conversation. Never used for direct
   * conversations, whose content stays between their two people.
   */
  getMessagesAround(type: ChannelType, id: string, messageId: string, limit: number): Promise<ChatMessage[]>;
  /** Soft by default: the conversation keeps a "message removed" marker. */
  deleteMessage(messageId: string, options: { hard: boolean }): Promise<void>;
  flagMessage(messageId: string, reporterChatUserId: string, reason: string): Promise<void>;

  blockUser(blockerChatUserId: string, blockedChatUserId: string): Promise<void>;
  unblockUser(blockerChatUserId: string, blockedChatUserId: string): Promise<void>;
  listBlockedUsers(blockerChatUserId: string): Promise<string[]>;

  muteChannel(type: ChannelType, id: string, chatUserId: string): Promise<void>;
  unmuteChannel(type: ChannelType, id: string, chatUserId: string): Promise<void>;

  listDevices(chatUserId: string): Promise<ChatDevice[]>;
  addDevice(chatUserId: string, device: ChatDevice): Promise<void>;
  removeDevice(chatUserId: string, token: string): Promise<void>;
  setPushPreferences(preferences: PushPreferenceInput[]): Promise<void>;

  /** Constant-time HMAC check of a webhook body against the app secret. */
  verifyWebhook(rawBody: string, signature: string): boolean;
}
