import { createServerClient } from "@supabase/ssr";
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";

export function createClient() {
  // Kept synchronous so the existing 100+ call sites retain one shared client
  // contract during the security-only Next 15 upgrade. Next 15 explicitly
  // provides this migration type; a later framework-modernization prompt can
  // make the application-wide API asynchronous.
  const cookieStore = cookies() as unknown as UnsafeUnwrappedCookies;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — safe to ignore when middleware refreshes the session
          }
        },
      },
    },
  );
}
