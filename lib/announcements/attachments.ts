import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export const COMMUNICATION_ATTACHMENTS_BUCKET = "communication-attachments";

/**
 * Gmail rejects a message over 35MB, and the base64 wrapper adds about a third
 * to whatever goes in it. 8MB per file keeps a bulletin and a flyer comfortably
 * inside that with room for the message itself.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** How many files may ride along with one weekly email. */
export const MAX_ATTACHMENTS_PER_CHURCH = 5;

/**
 * What a church may attach.
 *
 * Documents and images only. An attachment is authored by a church admin, but
 * it is delivered to a whole congregation, so anything executable — and
 * anything a mail client might treat as executable — is not on the list.
 */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const ALLOWED_ATTACHMENT_EXTENSIONS = Array.from(
  new Set(Object.values(ALLOWED_MIME_TYPES)),
);

export function isAllowedAttachmentType(mimeType: string): boolean {
  return Object.hasOwn(ALLOWED_MIME_TYPES, mimeType.toLowerCase());
}

export function extensionForMimeType(mimeType: string): string {
  return ALLOWED_MIME_TYPES[mimeType.toLowerCase()] ?? "bin";
}

/**
 * A filename safe to put in a Content-Disposition header and in storage.
 *
 * Strips directory separators and control characters — a name arrives from a
 * file picker and is echoed back into a mail header, where a stray newline
 * would let it invent headers of its own.
 */
export function sanitizeAttachmentName(name: string, fallbackExt: string): string {
  const base = name
    .replace(/[\r\n\t]/g, " ")
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 120);

  if (!base) return `attachment.${fallbackExt}`;

  // A dot anywhere is not an extension — "../../etc/passwd" has three and none
  // of them say what the file is. Only a short alphanumeric tail counts.
  return /\.[a-z0-9]{1,8}$/i.test(base) ? base : `${base}.${fallbackExt}`;
}

export type CommunicationAttachment = {
  id: string;
  churchId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

function mapRow(row: Record<string, unknown>): CommunicationAttachment {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    storagePath: row.storage_path as string,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes ?? 0),
    createdAt: row.created_at as string,
  };
}

/**
 * The church's standing attachment list.
 *
 * Returns nothing at all when migration 0067 has not been applied: an email
 * that goes out without its attachments beats an email that does not go out.
 */
export async function listCommunicationAttachments(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<CommunicationAttachment[]> {
  const client = supabase ?? createAdminClient();

  const { data, error } = await client
    .from("communication_attachments")
    .select("id, church_id, storage_path, file_name, mime_type, size_bytes, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    if (error && !/communication_attachments/i.test(error.message)) {
      console.error("[communications] attachment list failed:", error.message);
    }
    return [];
  }

  return (data as Record<string, unknown>[]).map(mapRow);
}

export type LoadedAttachment = {
  fileName: string;
  mimeType: string;
  content: Buffer;
};

/**
 * Downloads each attachment's bytes for a message being built.
 *
 * A file that cannot be read is skipped rather than thrown: the weekly draft is
 * the point, and one missing bulletin should not cost a church its email.
 */
export async function loadAttachmentsForSend(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<LoadedAttachment[]> {
  const attachments = await listCommunicationAttachments(churchId, supabase);
  if (attachments.length === 0) return [];

  const admin = createAdminClient();
  const loaded: LoadedAttachment[] = [];

  for (const attachment of attachments) {
    const { data, error } = await admin.storage
      .from(COMMUNICATION_ATTACHMENTS_BUCKET)
      .download(attachment.storagePath);

    if (error || !data) {
      console.error(
        `[communications] attachment ${attachment.fileName} could not be read:`,
        error?.message ?? "missing",
      );
      continue;
    }

    loaded.push({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      content: Buffer.from(await data.arrayBuffer()),
    });
  }

  return loaded;
}
