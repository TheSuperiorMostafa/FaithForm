import type { z } from "zod";

import { MobileError } from "@/lib/mobile/v1/errors";
import { readJsonBody } from "@/lib/mobile/v1/protocol";

/**
 * Reads a JSON body and validates it against a contract schema. A refusal
 * names the fields and the kind of problem — never the values sent, which may
 * be personal.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  message = "Check your request and try again.",
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new MobileError("invalid_request", message, {
      fields: parsed.error.issues.slice(0, 5).map((issue) => ({
        field: issue.path.join(".") || "body",
        issue: issue.code,
      })),
    });
  }
  return parsed.data;
}

/** A query parameter, trimmed and bounded, or null. */
export function queryParam(request: Request, name: string, max = 200): string | null {
  const value = new URL(request.url).searchParams.get(name)?.trim();
  return value ? value.slice(0, max) : null;
}
