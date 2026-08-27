/**
 * Public identifier for a church, minted once at creation.
 *
 * Kebab-cased name plus eight random hex characters, so two "First Baptist
 * Church" rows can coexist and a slug never has to be renegotiated when a
 * church renames itself. Shared by every path that creates a church — the
 * platform-admin console and self-serve setup — so the shape cannot drift.
 */
export function generateChurchSlug(name: string): string {
  const tempId = crypto.randomUUID();
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${baseSlug || "church"}-${tempId.replace(/-/g, "").slice(0, 8)}`;
}
