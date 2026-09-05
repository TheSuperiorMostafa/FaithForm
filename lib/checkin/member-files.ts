/**
 * Documents held against a person — background checks, signed waivers, the
 * paperwork a church is obliged to keep and obliged not to leave lying around.
 *
 * The bucket is private and nothing here ever hands out a durable URL. A file
 * is fetched through a route that re-checks who is asking, every time, because
 * the alternative — a public link that works forever for anyone who has it — is
 * exactly the wrong shape for a document that says whether somebody has a
 * criminal record.
 */

export const MEMBER_FILES_BUCKET = "member-files";

/** Enough for a scanned multi-page background check; short of a video. */
export const MAX_MEMBER_FILE_BYTES = 15 * 1024 * 1024;

export const MAX_FILES_PER_MEMBER = 20;

/**
 * Documents and images. Nothing executable, and nothing a browser would run:
 * these files are uploaded by one staff member and opened by another, which is
 * the shape of attack this list exists to close.
 */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/heic": "heic",
  "image/webp": "webp",
};

export const ALLOWED_MEMBER_FILE_EXTENSIONS = Array.from(
  new Set(Object.values(ALLOWED_MIME_TYPES)),
);

export function isAllowedMemberFileType(mimeType: string): boolean {
  return Object.hasOwn(ALLOWED_MIME_TYPES, mimeType.toLowerCase());
}

export function memberFileExtension(mimeType: string): string {
  return ALLOWED_MIME_TYPES[mimeType.toLowerCase()] ?? "bin";
}

/**
 * A filename safe to put in a Content-Disposition header and in storage.
 *
 * The name arrives from a file picker and is echoed back into a response
 * header, where a stray newline would let it invent headers of its own.
 */
export function sanitizeMemberFileName(
  name: string,
  fallbackExtension: string,
): string {
  const base = name
    .replace(/[\r\n\t]/g, " ")
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 120);

  if (!base) return `document.${fallbackExtension}`;

  // A dot anywhere is not an extension — "../../etc/passwd" has three and none
  // of them say what the file is. Only a short alphanumeric tail counts.
  return /\.[a-z0-9]{1,8}$/i.test(base) ? base : `${base}.${fallbackExtension}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
