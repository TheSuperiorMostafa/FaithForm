import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type AuthUserRecord = {
  id: string;
  email: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  /** Service-role-only metadata; carries feature grants pre-0041. */
  appMetadata: Record<string, unknown> | null;
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/**
 * GoTrue's admin API has no "get user by email", so finding one means paging
 * the directory. Cheap at FaithForm's scale and bounded by MAX_PAGES.
 */
export async function findAuthUserByEmail(
  email: string,
): Promise<AuthUserRecord | null> {
  const admin = createAdminClientOrNull();
  if (!admin) throw new Error("Service role key is not configured.");

  const target = email.trim().toLowerCase();
  if (!target) return null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });

    if (error) {
      throw new Error(error.message);
    }

    const users = data.users ?? [];
    const match = users.find(
      (user) => (user.email ?? "").toLowerCase() === target,
    );

    if (match) {
      return {
        id: match.id,
        email: match.email ?? null,
        lastSignInAt: match.last_sign_in_at ?? null,
        createdAt: match.created_at ?? null,
        appMetadata: (match.app_metadata ?? null) as Record<
          string,
          unknown
        > | null,
      };
    }

    if (users.length < PAGE_SIZE) break;
  }

  return null;
}

/** Resolves a small, known set of user ids — one lookup per id, no paging. */
export async function getAuthUsersByIds(
  userIds: string[],
): Promise<Map<string, AuthUserRecord>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return new Map();

  // Emails are a nice-to-have here; a missing service key degrades the roster
  // rather than breaking the page that renders it.
  const admin = createAdminClientOrNull();
  if (!admin) return new Map();

  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return null;
      return [
        id,
        {
          id,
          email: data.user.email ?? null,
          lastSignInAt: data.user.last_sign_in_at ?? null,
          createdAt: data.user.created_at ?? null,
          appMetadata: (data.user.app_metadata ?? null) as Record<
            string,
            unknown
          > | null,
        },
      ] as const;
    }),
  );

  return new Map(
    entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
}
