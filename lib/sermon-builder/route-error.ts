import { NextResponse } from "next/server";
import { toUserError } from "@/lib/errors/user-error";

/**
 * The catch-all for `app/api/sermon/*` routes: a plain sentence in `error`,
 * the engineering detail in the server log (via `toUserError`). Status codes
 * are unchanged: 401 for a lost session, 500 otherwise.
 */
export function sermonRouteError(error: unknown, fallback: string): NextResponse {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json(
      { error: "You've been signed out. Sign in again, then try once more." },
      { status: 401 },
    );
  }
  return NextResponse.json({ error: toUserError(error, fallback) }, { status: 500 });
}

export const SERMON_NOT_FOUND_MESSAGE =
  "We couldn't find that sermon. It may have been deleted. Go back to Sermons and try again.";
