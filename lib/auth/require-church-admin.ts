import { NextResponse } from "next/server";
import { getChurchAuth, requireChurchAuth, type ChurchAuth } from "@/lib/auth/church";

export async function requireChurchAdmin(): Promise<ChurchAuth> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) {
    throw new Error("Forbidden");
  }
  return auth;
}

export async function getChurchAdminOrNull(): Promise<ChurchAuth | null> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return null;
  return auth;
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
