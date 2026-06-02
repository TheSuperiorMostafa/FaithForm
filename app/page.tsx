import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: { code?: string; next?: string };
};

export default async function Page({ searchParams }: PageProps) {
  // Supabase sometimes sends magic links to Site URL root (?code=...) instead of /auth/callback.
  if (searchParams.code) {
    const params = new URLSearchParams({ code: searchParams.code });
    if (searchParams.next) {
      params.set("next", searchParams.next);
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
