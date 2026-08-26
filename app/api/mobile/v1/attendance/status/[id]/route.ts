import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getAttendanceStatus } from "@/lib/mobile/v1/attendance-service";

export const dynamic = "force-dynamic";

/** Whether this account is counted at one occurrence. */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const status = await getAttendanceStatus(userId, params.id);
    if (!status) throw new MobileError("not_found", "Service not found.");
    return { data: status };
  },
);
