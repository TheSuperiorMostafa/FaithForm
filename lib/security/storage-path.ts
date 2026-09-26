/**
 * Whether a storage object key is a plain key that stays inside `prefix`.
 *
 * storage-js puts the key into the request URL without encoding it, and URL
 * parsing resolves `..` segments before the request is sent. So
 * `<church>/../<other church>/file` passes a `startsWith("<church>/")` check
 * and then reads or overwrites the other church's object with whatever
 * credential the client holds — usually the service role. A `#` or `?` cuts
 * the rest of the key off the same way.
 *
 * `prefix` must end with "/". Every segment after it must be non-empty, not
 * "." or "..", and free of backslashes, `?`, `#`, `%` and control characters.
 */
export function isStorageKeyWithin(path: unknown, prefix: string): path is string {
  if (typeof path !== "string" || !prefix.endsWith("/")) return false;
  if (path.length > 1024 || !path.startsWith(prefix)) return false;
  if (/[\\?#%\u0000-\u001f\u007f]/.test(path)) return false;

  const rest = path.slice(prefix.length);
  if (!rest) return false;
  return rest.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** One key segment built from outside input: anything but `[A-Za-z0-9_-]` becomes `_`. */
export function storageKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
