import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { updateProfileRequestSchema } from "@/lib/mobile/v1/contract";
import { applyProfileUpdate } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

export const PATCH = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = updateProfileRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Check the values you entered.", {
        fields: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          issue: issue.code,
        })),
      });
    }
    return { data: await applyProfileUpdate(userId, parsed.data) };
  },
);
