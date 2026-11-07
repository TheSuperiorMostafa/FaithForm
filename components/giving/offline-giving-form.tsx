"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { recordOfflineGifts } from "@/app/dashboard/giving/offline-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { amountToCents, donationRowsFromSheet, type OfflineGiftInput } from "@/lib/giving/offline-input";
import { readDonationSheet } from "@/lib/giving/read-donation-sheet";
import { formatCents } from "@/lib/utils/currency";

const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base";

export function OfflineGivingForm({funds, donors}: {
  funds: {id: string; name: string}[];
  donors: {id: string; name: string | null; email: string}[];
}) {
  const [pending, startTransition] = useTransition();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<OfflineGiftInput[]>([]);
  const manualBatch = useRef<string | null>(null);
  const importBatch = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [chosenDonor, setChosenDonor] = useState("");

  function save(gifts: OfflineGiftInput[], batchId: string, imported: boolean) {
    startTransition(async () => {
      setError("");
      let result;
      try { result = await recordOfflineGifts({batchId, gifts}); }
      catch {setError("The connection was interrupted. Your entries are kept here; try again to check and finish recording them."); return;}
      if (!result.ok) {setError(result.error ?? "The donations couldn't be recorded. Please try again."); return;}
      toast.success(`${result.count} donation${result.count === 1 ? "" : "s"} recorded.`);
      if (imported) {setPreview([]); importBatch.current = null;}
      else {formRef.current?.reset(); setChosenDonor(""); manualBatch.current = null;}
    });
  }

  return <>
    <nav aria-label="Giving" className="flex flex-wrap gap-6">
      <Link className="flex min-h-11 items-center text-primary underline" href="/dashboard/giving">Back to Giving</Link>
      <Link className="flex min-h-11 items-center text-primary underline" href="/dashboard/giving/gifts">View recorded gifts</Link>
    </nav>
    {!funds.length && <p role="status">Add or reactivate a fund in <Link className="underline" href="/dashboard/giving/settings">Giving settings</Link> before recording donations.</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-destructive">{error}</p>}
    <Card className="p-6">
      <h2 className="mb-6 text-xl font-semibold">Add a donation</h2>
      <form ref={formRef} onSubmit={event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const gift: OfflineGiftInput = {
          date: String(values.get("date")), amount: String(values.get("amount")), fundId: String(values.get("fundId")),
          donorId: chosenDonor, donorName: String(values.get("donorName") ?? ""), donorEmail: String(values.get("donorEmail") ?? ""),
          method: String(values.get("method")) as "cash" | "check" | "other", giftType: "one_time",
        };
        manualBatch.current ??= crypto.randomUUID();
        save([gift], manualBatch.current, false);
      }}>
        <fieldset disabled={pending} className="space-y-6" onChange={() => {manualBatch.current = null;}}>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2"><span>Date</span><Input required type="date" name="date" defaultValue={new Date().toLocaleDateString("en-CA")} /></label>
            <label className="space-y-2"><span>Amount ($)</span><Input required name="amount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="50.00" /></label>
            <label className="space-y-2"><span>Fund</span><select required name="fundId" className={selectClass}><option value="">Choose a fund</option>{funds.map(fund => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select></label>
            <label className="space-y-2"><span>Donor</span><select value={chosenDonor} onChange={event => setChosenDonor(event.target.value)} className={selectClass}><option value="">New donor or unassigned gift</option>{donors.map(donor => <option key={donor.id} value={donor.id}>{donor.name || donor.email}</option>)}</select></label>
            {!chosenDonor && <>
              <label className="space-y-2"><span>Donor name (optional)</span><Input name="donorName" maxLength={200} autoComplete="name" /></label>
              <label className="space-y-2"><span>Donor email (optional)</span><Input name="donorEmail" type="email" autoComplete="email" /></label>
            </>}
            <label className="space-y-2"><span>Payment method</span><select name="method" className={selectClass}><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option></select></label>
          </div>
          <p className="text-sm text-muted-foreground">Choose an existing donor or enter an email to include this gift on their contribution statement. Unassigned gifts still count in church and fund totals.</p>
          <Button type="submit" disabled={!funds.length}>{pending ? "Recording…" : "Record donation"}</Button>
        </fieldset>
      </form>
    </Card>
    <Card className="space-y-5 p-6">
      <h2 className="text-xl font-semibold">Import a spreadsheet</h2>
      <p>Choose an Excel (.xlsx) or CSV file with up to 500 donations. The first sheet needs Date (YYYY-MM-DD), Amount (dollars), and Fund columns. Optional columns: Donor name, Donor email, Method (cash/check/other), Gift type (one_time/recurring).</p>
      <p className="text-sm text-muted-foreground">Use each fund&apos;s exact name. Import only gifts received outside FaithForm to avoid duplicating online donations. Donor email connects imported gifts to contribution statements.</p>
      <a className="inline-flex min-h-11 items-center text-primary underline" download="donations-template.csv" href={"data:text/csv;charset=utf-8," + encodeURIComponent("Date,Amount,Fund,Donor name,Donor email,Method,Gift type\r\n2026-01-01,50.00," + (funds[0]?.name ? '"' + funds[0].name.replaceAll('"', '""') + '"' : "General") + ",Jane Doe,jane@example.org,cash,one_time\r\n")}>Download a spreadsheet template</a>
      <label className="block space-y-2"><span>Donation spreadsheet</span><Input type="file" accept=".csv,.xlsx" disabled={pending || reading} onChange={async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        setError(""); setPreview([]); setReading(true);
        try {
          const gifts = donationRowsFromSheet(await readDonationSheet(file), funds);
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
          // The same file is one batch even after a refresh or a second upload.
          importBatch.current = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
          setPreview(gifts);
        }
        catch(error) {setError(error instanceof Error ? error.message : "This file couldn't be read. Try exporting it as CSV.");}
        finally {setReading(false); event.target.value = "";}
      }} /></label>
      {reading && <p role="status">Reading your spreadsheet…</p>}
      {preview.length > 0 && <div className="space-y-4">
        <p role="status">Review {preview.length} donations totaling {formatCents(preview.reduce((sum, gift) => sum + amountToCents(gift.amount), 0))}.</p>
        <div className="max-h-80 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr>{["Date", "Donor", "Fund", "Amount"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{preview.map((gift, index) => <tr key={index} className="border-t"><td className="p-3">{gift.date}</td><td className="p-3">{gift.donorName || gift.donorEmail || "Unassigned"}</td><td className="p-3">{funds.find(fund => fund.id === gift.fundId)?.name}</td><td className="p-3">{formatCents(amountToCents(gift.amount))}</td></tr>)}</tbody></table></div>
        <Button disabled={pending} onClick={async () => {
          if (!await confirmAction({title: `Record ${preview.length} donations?`, description: "These gifts will be included in church totals and matching donors' contribution statements. Make sure they haven't already been recorded.", confirmLabel: "Record donations"})) return;
          if (importBatch.current) save(preview, importBatch.current, true);
        }}>{pending ? "Recording…" : "Record imported donations"}</Button>
      </div>}
    </Card>
  </>;
}
