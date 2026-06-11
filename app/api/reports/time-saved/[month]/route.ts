import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { month: string } },
) {
  const url = new URL(request.url);
  url.pathname = `/api/reports/monthly/${params.month}`;
  return NextResponse.redirect(url, 308);
}
