import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  const url = new URL(request.url);
  url.pathname = `/api/reports/monthly/${month}`;
  return NextResponse.redirect(url, 308);
}
