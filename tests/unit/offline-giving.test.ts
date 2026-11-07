import assert from "node:assert/strict";
import test from "node:test";
import { amountToCents, donationRowsFromSheet, offlineGiftSchema, parseDonationCsv } from "@/lib/giving/offline-input";

const funds = [{id: "b1c1a5b1-1f17-42cc-973a-3ff33caa1122", name: "General"}];

test("offline gift amounts stay exact cents and reject rounding, negative and invalid values", () => {
  assert.equal(amountToCents("10.01"), 1001);
  assert.equal(amountToCents("0.29"), 29);
  assert.equal(amountToCents("50"), 5000);
  for (const amount of ["-1", "0", "1.009", "1e4", "NaN", "999999999999"]) {
    assert.equal(offlineGiftSchema.safeParse({date:"2026-11-06", amount, fundId:funds[0].id}).success, false, amount);
  }
  assert.equal(offlineGiftSchema.safeParse({date:"2026-02-30", amount:"1", fundId:funds[0].id}).success, false);
});

test("spreadsheet imports preserve quoted names and monetary cents with exact known funds", () => {
  const rows = parseDonationCsv('\uFEFFDate,Amount,Fund,Donor name,Donor email\r\n2026-01-02,"$1,234.56",General,"Doe, Jane",jane@example.org\r\n');
  const gifts = donationRowsFromSheet(rows, funds);
  assert.equal(gifts[0].donorName, "Doe, Jane");
  assert.equal(amountToCents(gifts[0].amount), 123456);
  assert.equal(gifts[0].method, "cash");
  assert.equal(gifts[0].giftType, "one_time");
  assert.equal(gifts[0].fundId, funds[0].id);
});

test("an invalid row rejects the entire import rather than silently omitting donations", () => {
  assert.throws(() => donationRowsFromSheet([["Date","Amount","Fund"],["2026-01-01","10","Other"]],funds), /Row 2/);
  assert.throws(() => donationRowsFromSheet([["Date","Amount","Fund"],["2026-01-01","-10","General"]],funds), /Row 2/);
  assert.throws(() => parseDonationCsv('Date,Amount\n"2026-01-01,10'), /not closed/);
  assert.throws(() => donationRowsFromSheet([["Date","Amount","Fund"],["2026-01-01","10","General"]], [...funds, {...funds[0],id: "bbbbbbbb-1111-4444-8888-112233445566"}]), /existing fund/);
});

test("quoted multiline and escaped quote cells survive CSV parsing", () => {
  assert.deepEqual(parseDonationCsv('a,b\r\n"two\nlines","A ""quote"""\r\n'), [["a","b"],["two\nlines",'A "quote"']]);
});
