import { logActivity } from "@/lib/activity/log";

export async function logAdminAction(input: {
  churchId: string;
  taskName: string;
  triggerSource: string;
}): Promise<void> {
  await logActivity({
    churchId: input.churchId,
    automationType: "Admin action",
    category: "Admin",
    taskName: input.taskName,
    triggerSource: input.triggerSource,
  });
}
