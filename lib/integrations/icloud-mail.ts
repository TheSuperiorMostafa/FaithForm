import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";

import {
  buildMailMessage,
  type MailMessageInput,
} from "@/lib/integrations/mime-message";
import { getIntegration } from "@/lib/integrations/tokens";
import type { AppleIntegrationMetadata } from "@/lib/integrations/types";

/**
 * The weekly announcement email, drafted in iCloud Mail.
 *
 * This mirrors the Gmail draft: FaithForm never sends anything. It saves one
 * finished message in the church's iCloud Drafts mailbox over IMAP (APPEND,
 * flagged \Draft), and the pastor reviews and sends it from Apple Mail.
 *
 * Apple has no mail API and no OAuth scope for mail, so this uses the
 * app-specific password the church already gave FaithForm for iCloud
 * Calendar. One app-specific password covers every iCloud service on its
 * Apple ID. The password goes to Apple's IMAP host, over verified TLS, and
 * nowhere else. Nothing here logs it, and imapflow's own logging is off.
 */

/** Fixed, not configurable: nothing a church types can point the login elsewhere. */
export const ICLOUD_IMAP_HOST = "imap.mail.me.com";
const ICLOUD_IMAP_PORT = 993;

/** Where a church finds the draft. iCloud has no link to a single draft. */
export const ICLOUD_MAIL_URL = "https://www.icloud.com/mail";

/**
 * Marks a draft id as iCloud's. The weekly draft id shares one text column
 * with Gmail's ids, and the prefix is how a later read tells which mailbox
 * the week's email went to, with no schema change.
 */
export const ICLOUD_DRAFT_ID_PREFIX = "icloud:";

/** The addresses iCloud Mail signs in with. A custom domain is not one of them. */
const ICLOUD_MAIL_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);

/**
 * Saved unread, a draft shows a badge in Apple Mail's Drafts mailbox. Apple
 * Mail saves its own drafts \Seen, so these are too.
 */
const DRAFT_FLAGS = ["\\Draft", "\\Seen"];

export class ICloudMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ICloudMailError";
  }
}

/** Apple turned the sign-in down: wrong address, revoked password, or no iCloud Mail. */
export class ICloudMailAuthError extends ICloudMailError {
  constructor(
    message = "iCloud Mail didn't accept FaithForm's sign-in. Check the iCloud Mail address in Settings, and that the app-specific password hasn't been revoked.",
  ) {
    super(message);
    this.name = "ICloudMailAuthError";
  }
}

const UNREACHABLE_MESSAGE =
  "FaithForm couldn't reach iCloud Mail. Try again in a moment.";

export function isICloudMailDomain(address: string): boolean {
  const domain = address.trim().toLowerCase().split("@").pop() ?? "";
  return ICLOUD_MAIL_DOMAINS.has(domain);
}

/**
 * The names Apple accepts for an iCloud Mail login, in the order to try them.
 *
 * Apple documents both: "usually the name part" of the address, or failing
 * that the whole address. The whole address comes first because it is what
 * the church typed; the name part is the fallback Apple itself suggests.
 */
export function icloudLoginCandidates(address: string): string[] {
  const full = address.trim().toLowerCase();
  const at = full.lastIndexOf("@");
  const namePart = at > 0 ? full.slice(0, at) : "";
  return namePart && isICloudMailDomain(full) ? [full, namePart] : [full];
}

type AppleMailFields = Pick<
  AppleIntegrationMetadata,
  "mode" | "apple_id" | "mail_address" | "mail_enabled" | "mail_verified_at"
>;

/**
 * The church asked for iCloud Mail. Read from metadata alone, without the
 * password, which is all the Monday run's church list needs to know.
 */
export function icloudMailOptedIn(metadata: AppleMailFields | null | undefined): boolean {
  if (!metadata) return false;
  return (
    metadata.mode !== "public_link" &&
    metadata.mail_enabled === true &&
    Boolean(metadata.mail_address?.trim())
  );
}

/**
 * Everything a draft needs is in place: an Apple ID connection (a link
 * connection has no password to sign in with), a password that has not been
 * cleared by a reconnect flag, and an address FaithForm has signed in with.
 */
export function icloudMailReady(input: {
  hasPassword: boolean;
  metadata: AppleMailFields | null | undefined;
}): boolean {
  return (
    input.hasPassword &&
    icloudMailOptedIn(input.metadata) &&
    Boolean(input.metadata?.apple_id) &&
    Boolean(input.metadata?.mail_verified_at)
  );
}

/**
 * The few ImapFlow calls this module makes. Tests stand in a fake, or a real
 * ImapFlow pointed at a local server; production always gets Apple's host.
 */
export type ImapSession = {
  connect(): Promise<void>;
  list(options?: { listOnly?: boolean }): Promise<
    Array<{
      path: string;
      specialUse?: string;
      specialUseSource?: string;
      flags?: Set<string>;
    }>
  >;
  append(
    path: string,
    content: Buffer,
    flags?: string[],
    idate?: Date,
  ): Promise<{ uid?: number; uidValidity?: bigint } | false | undefined>;
  logout(): Promise<void>;
  close(): void;
  on(event: "error", listener: (err: Error) => void): unknown;
};

export type OpenImapSession = (login: { user: string; pass: string }) => ImapSession;

export const openICloudImapSession: OpenImapSession = (login) =>
  new ImapFlow({
    host: ICLOUD_IMAP_HOST,
    port: ICLOUD_IMAP_PORT,
    secure: true,
    servername: ICLOUD_IMAP_HOST,
    // Certificate checks stay on: they are what keeps the password Apple's.
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: login.user, pass: login.pass },
    // No logging of any kind. imapflow masks passwords in its own logs, but
    // a server log is no place for mail traffic either.
    logger: false,
    emitLogs: false,
    clientInfo: { name: "FaithForm" },
    // One short session per draft: nothing to idle for.
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

export type ICloudMailCredentials = {
  /** The iCloud Mail address, not necessarily the Apple ID. */
  address: string;
  /** The app-specific password. */
  password: string;
};

type ImapFailure = {
  authenticationFailed?: boolean;
  serverResponseCode?: string;
};

function responseCode(err: unknown): string {
  return ((err as ImapFailure | null)?.serverResponseCode ?? "").toUpperCase();
}

/** UNAVAILABLE is Apple saying "not now", not "wrong password". */
function isAuthFailure(err: unknown): boolean {
  return (
    Boolean((err as ImapFailure | null)?.authenticationFailed) &&
    responseCode(err) !== "UNAVAILABLE"
  );
}

function quietlyClose(session: ImapSession): void {
  try {
    session.close();
  } catch {
    // Already closed.
  }
}

async function signOut(session: ImapSession): Promise<void> {
  try {
    await session.logout();
  } catch {
    quietlyClose(session);
  }
}

/** Signs in with the first login name Apple accepts. */
async function signIn(
  credentials: ICloudMailCredentials,
  open: OpenImapSession,
): Promise<ImapSession> {
  for (const user of icloudLoginCandidates(credentials.address)) {
    const session = open({ user, pass: credentials.password });
    // Once connected, a dropped socket arrives as an 'error' event, and Node
    // treats an unheard one as a crash. The command in flight rejects too,
    // which is where the failure is actually handled.
    session.on("error", () => undefined);

    try {
      await session.connect();
      return session;
    } catch (err) {
      quietlyClose(session);
      if (isAuthFailure(err)) continue;
      throw new ICloudMailError(UNREACHABLE_MESSAGE);
    }
  }

  throw new ICloudMailAuthError();
}

/**
 * The mailbox Apple Mail saves drafts in.
 *
 * iCloud flags it \Drafts (RFC 6154), and imapflow also recognises the name.
 * The server's own flag wins over a name match, and a mailbox that cannot
 * hold messages is never picked.
 */
export function pickDraftsMailbox(
  mailboxes: Awaited<ReturnType<ImapSession["list"]>>,
): string | null {
  const usable = mailboxes.filter(
    (mailbox) =>
      !mailbox.flags?.has("\\Noselect") && !mailbox.flags?.has("\\NonExistent"),
  );
  const flagged = usable.filter((mailbox) => mailbox.specialUse === "\\Drafts");

  const chosen =
    flagged.find((mailbox) => mailbox.specialUseSource === "extension") ??
    flagged[0] ??
    usable.find((mailbox) => mailbox.path.toLowerCase() === "drafts");

  return chosen?.path ?? null;
}

async function findDraftsMailbox(session: ImapSession): Promise<string> {
  let mailboxes: Awaited<ReturnType<ImapSession["list"]>>;
  try {
    mailboxes = await session.list({ listOnly: true });
  } catch {
    throw new ICloudMailError(UNREACHABLE_MESSAGE);
  }

  const drafts = pickDraftsMailbox(mailboxes);
  if (!drafts) {
    throw new ICloudMailError(
      "iCloud Mail signed in, but there's no Drafts mailbox to save the email in. Open iCloud Mail at icloud.com once, then try again.",
    );
  }
  return drafts;
}

/**
 * Proves an address works before it is saved: signs in with it and the
 * church's app-specific password, and finds the Drafts mailbox. Nothing is
 * written to the mailbox.
 */
export async function verifyICloudMailDrafts(
  credentials: ICloudMailCredentials,
  open: OpenImapSession = openICloudImapSession,
): Promise<{ draftsMailbox: string }> {
  const session = await signIn(credentials, open);
  try {
    return { draftsMailbox: await findDraftsMailbox(session) };
  } finally {
    await signOut(session);
  }
}

function appendFailureMessage(err: unknown): string {
  const code = responseCode(err);
  if (code === "OVERQUOTA") {
    return "Your iCloud storage is full, so iCloud Mail can't save the email. Free up some space and try again.";
  }
  if (code === "TOOBIG" || code === "LIMIT" || code === "APPENDLIMIT") {
    return "This week's email is too large for iCloud Mail. Try removing an attachment.";
  }
  return "iCloud Mail wouldn't save the email. Try again in a moment.";
}

/**
 * Where this draft can be found again. UIDPLUS gives the mailbox generation
 * and the message's UID; without it, the Message-ID still names the draft.
 */
export function icloudDraftId(
  appended: { uid?: number; uidValidity?: bigint },
  messageId: string,
): string {
  if (appended.uidValidity !== undefined && appended.uid) {
    return `${ICLOUD_DRAFT_ID_PREFIX}${appended.uidValidity.toString()}:${appended.uid}`;
  }
  return `${ICLOUD_DRAFT_ID_PREFIX}${messageId.replace(/^<|>$/g, "")}`;
}

/** Saves one finished message to the Drafts mailbox. */
export async function appendICloudDraft(
  credentials: ICloudMailCredentials,
  message: { raw: string; date: Date; messageId: string },
  open: OpenImapSession = openICloudImapSession,
): Promise<{ draftId: string; mailbox: string }> {
  const session = await signIn(credentials, open);
  try {
    const mailbox = await findDraftsMailbox(session);

    let appended: Awaited<ReturnType<ImapSession["append"]>>;
    try {
      appended = await session.append(
        mailbox,
        Buffer.from(message.raw, "utf8"),
        DRAFT_FLAGS,
        message.date,
      );
    } catch (err) {
      throw new ICloudMailError(appendFailureMessage(err));
    }

    if (!appended) {
      throw new ICloudMailError(appendFailureMessage(null));
    }

    return { draftId: icloudDraftId(appended, message.messageId), mailbox };
  } finally {
    await signOut(session);
  }
}

/**
 * The weekly email as an iCloud Mail draft for this church.
 *
 * The message is the same one the Gmail draft is built from, plus the
 * envelope headers Gmail would have stamped on it itself.
 */
export async function createICloudMailDraft(
  churchId: string,
  input: MailMessageInput,
  supabase?: SupabaseClient,
  options?: { now?: Date; open?: OpenImapSession },
): Promise<{ draftId: string; draftUrl: string }> {
  const integration = await getIntegration(churchId, "apple", supabase);
  const metadata = (integration?.metadata ?? {}) as AppleIntegrationMetadata;
  const password = integration?.access_token ?? "";

  if (
    !icloudMailReady({ hasPassword: Boolean(password.trim()), metadata }) ||
    !metadata.mail_address
  ) {
    throw new ICloudMailError(
      "iCloud Mail isn't set up for your church. Turn it on in Settings, under Integrations.",
    );
  }

  const date = options?.now ?? new Date();
  const messageId = `<${randomUUID()}@faithform.io>`;
  const raw = buildMailMessage(input, {
    from: metadata.mail_address,
    date,
    messageId,
  });

  const { draftId } = await appendICloudDraft(
    { address: metadata.mail_address, password },
    { raw, date, messageId },
    options?.open,
  );

  return { draftId, draftUrl: ICLOUD_MAIL_URL };
}
