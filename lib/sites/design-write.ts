import { sanitizeCustomCss } from "@/lib/sites/resolve";

/** Hidden platform CSS survives ordinary church-admin colour/theme saves. */
export function customCssWrite(input: {
  requested: string | undefined;
  current: string | null;
  platformAdmin: boolean;
}): { ok: true; patch: { custom_css?: string | null } } | { ok: false } {
  if (input.requested === undefined) return { ok: true, patch: {} };
  const next = sanitizeCustomCss(input.requested);
  if (!input.platformAdmin) {
    return next === sanitizeCustomCss(input.current)
      ? { ok: true, patch: {} }
      : { ok: false };
  }
  return { ok: true, patch: { custom_css: next } };
}
