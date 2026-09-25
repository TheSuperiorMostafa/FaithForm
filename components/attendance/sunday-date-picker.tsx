"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarSearch } from "lucide-react";

import { isSundayDate } from "@/lib/attendance/v2/sunday-worship";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(date: string): string | null {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? null;
}

/**
 * "Pick another date": any Sunday, not only the ones listed. A weekday is
 * pointed at Services, where Bible study and other weekday services are
 * counted, rather than refused with no way forward.
 */
export function SundayDatePicker({ today }: { today: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [problem, setProblem] = useState<"weekday" | "future" | null>(null);

  const open = (event: FormEvent) => {
    event.preventDefault();
    if (!date) return;
    if (date > today) {
      setProblem("future");
      return;
    }
    if (!isSundayDate(date)) {
      setProblem("weekday");
      return;
    }
    setProblem(null);
    router.push(`/dashboard/attendance/${date}`);
  };

  return (
    <form onSubmit={open} className="flex flex-col gap-3" noValidate>
      <Label htmlFor="sunday-date" className="text-base font-semibold">
        Pick another date
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
        <Input
          id="sunday-date"
          type="date"
          value={date}
          max={today}
          onChange={(event) => {
            setDate(event.target.value);
            setProblem(null);
          }}
          aria-describedby={problem ? "sunday-date-problem" : undefined}
          className="min-h-12 text-base"
        />
        <Button type="submit" variant="outline" className="min-h-12 shrink-0" disabled={!date}>
          <CalendarSearch aria-hidden />
          Open
        </Button>
      </div>
      {problem === "weekday" ? (
        <p id="sunday-date-problem" role="alert" className="text-[15px] text-foreground">
          That&apos;s a {weekdayOf(date) ?? "weekday"}. Sunday count is for Sundays.
          Weekday services, like Bible study, are counted on{" "}
          <Link href="/dashboard/attendance/services" className="font-semibold text-accent underline-offset-4 hover:underline">
            Services
          </Link>
          .
        </p>
      ) : problem === "future" ? (
        <p id="sunday-date-problem" role="alert" className="text-[15px] text-foreground">
          That Sunday hasn&apos;t happened yet. Pick today or an earlier Sunday.
        </p>
      ) : null}
    </form>
  );
}
