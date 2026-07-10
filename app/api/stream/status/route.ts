import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const status = await getLiveBroadcastStatus(auth.churchId, supabase);
  return NextResponse.json(status);
}
