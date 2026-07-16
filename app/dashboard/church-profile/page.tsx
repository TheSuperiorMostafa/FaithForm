import { redirect } from "next/navigation";
import { ChurchProfileForm } from "@/components/church-profile/church-profile-form";
import { getChurchAuth } from "@/lib/auth/church";
import {
  emptyChurchProfileForm,
  profileToFormState,
} from "@/lib/queries/church-profile";
import { loadChurchProfileForPage } from "@/app/dashboard/church-profile/actions";

export const dynamic = "force-dynamic";

export default async function ChurchProfilePage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await loadChurchProfileForPage(auth.churchId);
  const initialForm = profile
    ? profileToFormState(profile)
    : emptyChurchProfileForm();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Church Profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Single source of truth for your church identity, services, staff, and AI knowledge.
        </p>
      </div>

      <ChurchProfileForm initialForm={initialForm} isAdmin={auth.isAdmin} />
    </div>
  );
}
