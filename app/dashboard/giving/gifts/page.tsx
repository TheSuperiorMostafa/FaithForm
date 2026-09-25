import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";

import { GivingNotReady, GivingSubpageHeader, plural } from "@/components/giving/giving-page-parts";
import { GiftsTable } from "@/components/giving/gifts-table";
import { GiftsToolbar } from "@/components/giving/gifts-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getChurchGivingProfile,
  getGivingFunds,
  searchGifts,
  sumGifts,
} from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";
import type { DonationStatus, GiftType, GiftsSearchFilters } from "@/types/giving";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTER_KEYS = ["search", "fundId", "giftType", "status", "dateFrom", "dateTo"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function GiftsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GiftsHeader exportHref={null} />
        <GivingNotReady isAdmin={auth.isAdmin} />
      </div>
    );
  }

  const page = Math.max(1, Number.parseInt(String(str(query.page) ?? "1"), 10) || 1);
  const pageSize = 25;
  const dateFrom = str(query.dateFrom);
  const dateTo = str(query.dateTo);

  const filters: GiftsSearchFilters = {
    search: str(query.search),
    fundId: str(query.fundId),
    giftType: str(query.giftType) as GiftType | undefined,
    status: str(query.status) as DonationStatus | undefined,
    dateFrom: dateFrom && DATE_RE.test(dateFrom) ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo && DATE_RE.test(dateTo) ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
  };

  const exportParams = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = str(query[key]);
    if (value) exportParams.set(key, value);
  }
  const exportHref = auth.isAdmin
    ? `/api/dashboard/giving/export${exportParams.size ? `?${exportParams.toString()}` : ""}`
    : null;

  let data;
  try {
    const [result, totals, funds] = await Promise.all([
      searchGifts(auth.churchId, filters, page, pageSize),
      sumGifts(auth.churchId, filters),
      getGivingFunds(auth.churchId),
    ]);
    data = { result, totals, funds };
  } catch (error) {
    console.error("[giving] gifts failed to load", error);
    return (
      <div className="flex w-full flex-col gap-8">
        <GiftsHeader exportHref={null} />
        <ErrorState
          title="Gifts didn't load"
          description="No gifts were lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }
  const { result, totals, funds } = data;
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const filtered = FILTER_KEYS.some((key) => Boolean(str(query[key])));

  return (
    <div className="flex w-full flex-col gap-8">
      <GiftsHeader exportHref={exportHref} />

      <GiftsToolbar funds={funds.filter((f) => f.isActive)} />

      <section aria-labelledby="gifts-summary" className="flex flex-col gap-4">
        <p id="gifts-summary" className="text-lg text-foreground" aria-live="polite">
          <strong className="font-heading text-2xl font-bold">{plural(result.total, "gift")}</strong>
          <span className="text-muted-foreground"> · </span>
          <strong className="font-heading text-2xl font-bold">
            {formatCents(filters.status ? totals.totalCents : totals.receivedCents)}
          </strong>{" "}
          <span className="text-muted-foreground">
            {filters.status ? "in total" : "received"}
            {filtered ? " with these filters" : ""}
          </span>
        </p>

        <Card className="overflow-hidden p-0">
          <GiftsTable donations={result.donations} isAdmin={auth.isAdmin} filtered={filtered} />
        </Card>
        <p className="text-sm text-muted-foreground">
          &ldquo;After fees&rdquo; is what reaches your bank once the card processing fee is taken out.
        </p>
      </section>

      {totalPages > 1 && (
        <nav aria-label="Pages of gifts" className="flex flex-wrap items-center justify-center gap-3">
          {page > 1 && (
            <PaginationLink searchParams={query} page={page - 1}>
              Previous page
            </PaginationLink>
          )}
          <span className="text-[15px] text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <PaginationLink searchParams={query} page={page + 1}>
              Next page
            </PaginationLink>
          )}
        </nav>
      )}
    </div>
  );
}

function GiftsHeader({ exportHref }: { exportHref: string | null }) {
  return (
    <GivingSubpageHeader
      page="gifts"
      secondary={
        exportHref ? (
          <a href={exportHref} className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden />
            Download spreadsheet (CSV)
          </a>
        ) : null
      }
    />
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
      className={cn(buttonVariants({ variant: "outline" }))}
    >
      {children}
    </Link>
  );
}
