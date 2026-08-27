import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const query = await searchParams;
  // Supabase sometimes sends auth links to Site URL root (?code=...) instead
  // of /auth/callback — notably whenever a redirect isn't on its allow-list.
  // Forward the whole query, not just the code: `next` and any flow hints
  // must survive the hop or a reset link degrades into a plain sign-in.
  if (typeof query.code === "string") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") params.set(key, value);
    }
    redirect(`/auth/callback?${params.toString()}`);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  redirect("/login");
}
