import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: link } = await supabase
    .from("church_users")
    .select("role, churches(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const linkRow = link as
    | { role: string; churches: { name: string } | { name: string }[] | null }
    | null;
  const churchName = linkRow?.churches
    ? Array.isArray(linkRow.churches)
      ? (linkRow.churches[0]?.name ?? null)
      : linkRow.churches.name
    : null;
  const role = linkRow?.role ?? null;

  const initialCollapsed = cookies().get("sidebar:collapsed")?.value === "1";

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        userEmail={user.email ?? ""}
        churchName={churchName}
        role={role}
        initialCollapsed={initialCollapsed}
      />

      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar userEmail={user.email ?? ""} churchName={churchName} />

        <main className="flex-1 overflow-y-auto p-5 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
