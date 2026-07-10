const DEFAULT_PATH = "/dashboard";

/**
 * Returns a safe same-origin relative path for post-auth redirects.
 * Rejects protocol-relative, absolute, and backslash paths.
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_PATH;

  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return DEFAULT_PATH;
  }

  if (/^\/\s*https?:/i.test(trimmed)) {
    return DEFAULT_PATH;
  }

  return trimmed;
}
