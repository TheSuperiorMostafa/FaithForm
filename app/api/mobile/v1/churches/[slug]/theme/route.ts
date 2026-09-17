import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { updateChurchThemeRequestSchema } from "@/lib/mobile/v1/contract";
import { updateChurchTheme } from "@/lib/mobile/v1/church-theme-service";

export const dynamic = "force-dynamic";

export const PUT = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request, params }) => {
    const parsed = updateChurchThemeRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Choose two valid theme colors.");
    }
    return { data: await updateChurchTheme(userId, params.slug, parsed.data) };
  },
);
