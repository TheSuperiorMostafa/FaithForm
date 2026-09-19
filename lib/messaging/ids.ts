import { createHash } from "node:crypto";

/**
 * Chat-provider identifiers, derived from FaithForm ids.
 *
 * Deterministic on purpose: a reconciler that retries after "the channel was
 * created but our write was lost" computes the same id and converges on the
 * same channel instead of creating a second one. That is what lets every
 * provider write be retried blindly.
 *
 * Opaque where it matters. A church's uuid is never a public handle (the slug
 * is), and a person's sign-in id is nobody else's business, so both are
 * hashed. A group's uuid is already its public handle in the mobile contract,
 * so its channel id carries it in the clear — which is also what lets a push
 * notification name the group it came from.
 *
 * Every provider id is lowercase `[a-z0-9_]`, well inside Stream's 64-character
 * limit (`church_<uuid>_group_<uuid>` is 86 and does not fit).
 */

export const GROUP_CHANNEL_TYPE = "ff_group" as const;
export const DM_CHANNEL_TYPE = "ff_dm" as const;
export type ChannelType = typeof GROUP_CHANNEL_TYPE | typeof DM_CHANNEL_TYPE;

/** The provider identity that creates channels server-side. Never a person. */
export const SYSTEM_CHAT_USER_ID = "ff_system";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lowercase, unpadded. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function digest(input: string, length: number): string {
  return base32(createHash("sha256").update(input, "utf8").digest()).slice(0, length);
}

function requireUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`${label} must be a uuid`);
  return value.toLowerCase();
}

/** The tenant a church's channels and people belong to. */
export function chatTeamForChurch(churchId: string): string {
  return `ch_${digest(`faithform:church:${requireUuid(churchId, "churchId")}`, 24)}`;
}

/** One chat identity per sign-in, on the web and on a phone alike. */
export function chatUserIdFor(authUserId: string): string {
  return `ff_${digest(`faithform:user:${requireUuid(authUserId, "authUserId")}`, 26)}`;
}

export function groupChannelId(groupId: string): string {
  return `grp_${requireUuid(groupId, "groupId").replace(/-/g, "")}`;
}

/** The group a channel belongs to, or null for anything that is not one. */
export function groupIdFromChannelId(channelId: string): string | null {
  const match = /^grp_([0-9a-f]{32})$/.exec(channelId);
  if (!match) return null;
  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One conversation per pair of people per church. The pair is ordered, so
 * whoever starts it lands on the same channel.
 */
export function dmChannelId(churchId: string, userA: string, userB: string): string {
  const church = requireUuid(churchId, "churchId");
  const [low, high] = [requireUuid(userA, "userA"), requireUuid(userB, "userB")].sort();
  if (low === high) throw new Error("a conversation needs two different people");
  return `dm_${digest(`faithform:dm:${church}:${low}:${high}`, 30)}`;
}

export function orderedPair(userA: string, userB: string): [string, string] {
  return [userA.toLowerCase(), userB.toLowerCase()].sort() as [string, string];
}

export type ParsedCid = { type: ChannelType; id: string };

/**
 * Parses a channel cid (`type:id`) that FaithForm could have created, and
 * nothing else. Used on every inbound value — a push payload, a report, a
 * webhook — so an arbitrary string never reaches a query.
 */
export function parseCid(cid: unknown): ParsedCid | null {
  if (typeof cid !== "string" || cid.length > 80) return null;
  const [type, id, extra] = cid.split(":");
  if (extra !== undefined || !type || !id) return null;
  if (type === GROUP_CHANNEL_TYPE && /^grp_[0-9a-f]{32}$/.test(id)) return { type, id };
  if (type === DM_CHANNEL_TYPE && /^dm_[a-z2-7]{30}$/.test(id)) return { type, id };
  return null;
}

export function cidOf(type: ChannelType, id: string): string {
  return `${type}:${id}`;
}

export function isChatUserId(value: unknown): value is string {
  return typeof value === "string" && /^ff_[a-z2-7]{26}$/.test(value);
}
