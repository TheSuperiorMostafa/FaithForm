import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { Toaster } from "sonner";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSuperAdmin();
  const email = user.email ?? "Super admin";

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <AdminSidebar userEmail={email} />
      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <AdminMobileNav userEmail={email} />
        <main className="flex-1 overflow-y-auto p-5 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>
      <Toaster richColors position="top-center" />
    </div>
  );
}
