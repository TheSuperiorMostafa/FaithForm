import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GiftsTable } from "@/components/giving/gifts-table";
import { GiftsToolbar } from "@/components/giving/gifts-toolbar";
import { GivingSetupCta } from "@/components/giving/giving-setup-cta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getChurchGivingProfile,
  getGivingFunds,
  searchGifts,
} from "@/lib/queries/giving";
import type { DonationStatus, GiftType, GiftsSearchFilters } from "@/types/giving";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GiftsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="mx-auto max-w-3xl flex flex-col gap-6">
        <BackLink />
        <GivingSetupCta />
      </div>
    );
  }

  const page = Number.parseInt(String(query.page ?? "1"), 10) || 1;
  const pageSize = 25;

  const filters: GiftsSearchFilters = {
    search: str(query.search),
    fundId: str(query.fundId),
    giftType: str(query.giftType) as GiftType | undefined,
    status: str(query.status) as DonationStatus | undefined,
    dateFrom: str(query.dateFrom)
      ? new Date(str(query.dateFrom)!).toISOString()
      : undefined,
    dateTo: str(query.dateTo)
      ? new Date(`${str(query.dateTo)}T23:59:59`).toISOString()
      : undefined,
  };

  const [result, funds] = await Promise.all([
    searchGifts(auth.churchId, filters, page, pageSize),
    getGivingFunds(auth.churchId),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BackLink />
      <h1 className="font-heading text-2xl font-bold">Gifts</h1>

      <Suspense fallback={null}>
        <GiftsToolbar funds={funds.filter((f) => f.isActive)} />
      </Suspense>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>
            {result.total} gift{result.total === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <GiftsTable donations={result.donations} isAdmin={auth.isAdmin} />
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <PaginationLink searchParams={query} page={page - 1}>
              Previous
            </PaginationLink>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <PaginationLink searchParams={query} page={page + 1}>
              Next
            </PaginationLink>
          )}
        </div>
      )}
    </div>
  );
}

function str(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function PaginationLink({
  searchParams,
  page,
  children,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  page: number;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params.set(key, v);
  }
  params.set("page", String(page));
  return (
    <Link
      href={`/dashboard/giving/gifts?${params.toString()}`}
      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
    >
      {children}
    </Link>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/giving" className="text-sm text-accent hover:underline">
      ← Back to Giving
    </Link>
  );
}
