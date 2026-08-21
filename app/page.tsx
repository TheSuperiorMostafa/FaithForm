import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ code?: string; next?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const query = await searchParams;
  // Supabase sometimes sends magic links to Site URL root (?code=...) instead of /auth/callback.
  if (query.code) {
    const params = new URLSearchParams({ code: query.code });
    if (query.next) {
      params.set("next", query.next);
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
