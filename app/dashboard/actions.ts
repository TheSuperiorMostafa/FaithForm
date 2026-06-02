"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function saveWeeklyInputs(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) return { error: "No church linked" };

  const followUps = Number(formData.get("follow_ups") ?? 0);
  const phoneCalls = Number(formData.get("phone_calls") ?? 0);
  const weekStart = startOfWeek(new Date()).toISOString().slice(0, 10);

  const { error } = await supabase.from("weekly_inputs").upsert(
    {
      church_id: churchId,
      week_start: weekStart,
      follow_ups: followUps,
      phone_calls: phoneCalls,
    },
    { onConflict: "church_id,week_start" },
  );

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { success: true };
}
