"use client";

import { useId, useState } from "react";
import { Download } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** One donor's year-end statement PDF, for the year chosen. */
export function DonorStatementDownload({
  donorId,
  years,
  defaultYear,
}: {
  donorId: string;
  years: number[];
  defaultYear: number;
}) {
  const [year, setYear] = useState(defaultYear);
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={id}>Statement year</Label>
        <Select
          id={id}
          value={String(year)}
          className="w-32"
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>
      <a
        href={`/api/dashboard/giving/statements/${donorId}?year=${year}`}
        className={buttonVariants({ size: "lg" })}
      >
        <Download aria-hidden />
        Download {year} statement
      </a>
    </div>
  );
}
