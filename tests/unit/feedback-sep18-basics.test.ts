import assert from "node:assert/strict";
import test from "node:test";

import {
  isSundayDate,
  isSundayWorshipOccurrence,
  isWorshipLabel,
} from "@/lib/attendance/v2/sunday-worship";
import { getChurchSmsSender } from "@/lib/sms/church-sender";
import { formatUsPhoneDisplay, formatUsPhoneInput, toE164 } from "@/lib/sms/phone";
import {
  eventOverlapsDay,
  eventStartDay,
  formatEventStart,
} from "@/lib/utils/calendar";

// ---------------------------------------------------------------------------
// Services board: Sunday worship only
// ---------------------------------------------------------------------------

test("the Services board keeps Sunday worship, whatever the church calls it", () => {
  const sunday = "2026-09-20";
  for (const label of [
    "Sunday Worship",
    "Morning Worship",
    "Sunday Service",
    "Early Service",
    "Late Service",
    "Worship",
    "Traditional",
    "Contemporary",
  ]) {
    assert.equal(
      isSundayWorshipOccurrence({ label, localServiceDate: sunday, generationSource: "schedule" }),
      true,
      label,
    );
  }
});

test("classes, groups and weeknight services are not on the Services board", () => {
  assert.equal(isSundayDate("2026-09-20"), true);
  assert.equal(isSundayDate("2026-09-23"), false);

  for (const label of ["Sunday School", "Bible Study", "Youth Group", "Kids Church", "Children's Church", "Choir Rehearsal", "Prayer Meeting"]) {
    assert.equal(isWorshipLabel(label), false, label);
  }

  assert.equal(
    isSundayWorshipOccurrence({
      label: "Wednesday Night Service",
      localServiceDate: "2026-09-23",
      generationSource: "schedule",
    }),
    false,
  );
  // Staff added it by hand, on purpose: it stays.
  assert.equal(
    isSundayWorshipOccurrence({
      label: "Christmas Eve Candlelight",
      localServiceDate: "2026-12-24",
      generationSource: "manual",
    }),
    true,
  );
});

// ---------------------------------------------------------------------------
// Phone numbers read 123-456-7890
// ---------------------------------------------------------------------------

test("a phone number formats as 123-456-7890 while it is typed", () => {
  assert.equal(formatUsPhoneInput(""), "");
  assert.equal(formatUsPhoneInput("5"), "5");
  assert.equal(formatUsPhoneInput("502"), "502");
  assert.equal(formatUsPhoneInput("5025"), "502-5");
  assert.equal(formatUsPhoneInput("502555"), "502-555");
  assert.equal(formatUsPhoneInput("5025550134"), "502-555-0134");
  assert.equal(formatUsPhoneInput("50255501349999"), "502-555-0134");
  assert.equal(formatUsPhoneInput("(502) 555-0134"), "502-555-0134");
  assert.equal(formatUsPhoneInput("+1 (502) 555-0134"), "502-555-0134");
  assert.equal(formatUsPhoneInput("15025550134"), "502-555-0134");
  // International numbers are left as typed.
  assert.equal(formatUsPhoneInput("+44 20 7946 0958"), "+44 20 7946 0958");
  // The server still reads the formatted value.
  assert.equal(toE164(formatUsPhoneInput("5025550134")), "+15025550134");
});

test("a stored number shows as 123-456-7890", () => {
  assert.equal(formatUsPhoneDisplay("+15025550134"), "502-555-0134");
  assert.equal(formatUsPhoneDisplay("5025550134"), "502-555-0134");
  assert.equal(formatUsPhoneDisplay("+442079460958"), "+442079460958");
  assert.equal(formatUsPhoneDisplay(null), null);
});

// ---------------------------------------------------------------------------
// Announcements calendar: an all-day event sits on its own day
// ---------------------------------------------------------------------------

test("an all-day event is on its date and only its date, in any timezone", () => {
  const picnic = {
    startAt: "2026-09-19T00:00:00.000Z",
    endAt: "2026-09-20T00:00:00.000Z",
    allDay: true,
  };
  assert.equal(eventOverlapsDay(picnic, new Date(2026, 8, 18)), false);
  assert.equal(eventOverlapsDay(picnic, new Date(2026, 8, 19)), true);
  assert.equal(eventOverlapsDay(picnic, new Date(2026, 8, 20)), false);
  assert.equal(eventStartDay(picnic).getDate(), 19);
  assert.equal(formatEventStart(picnic), "All day");

  const retreat = {
    startAt: "2026-09-12T00:00:00.000Z",
    endAt: "2026-09-15T00:00:00.000Z",
    allDay: true,
  };
  assert.equal(eventOverlapsDay(retreat, new Date(2026, 8, 14)), true);
  assert.equal(eventOverlapsDay(retreat, new Date(2026, 8, 15)), false);
});

test("a timed event still overlaps by the clock", () => {
  const start = new Date(2026, 8, 20, 10, 30);
  const event = {
    startAt: start.toISOString(),
    endAt: new Date(2026, 8, 20, 12, 0).toISOString(),
  };
  assert.equal(eventOverlapsDay(event, new Date(2026, 8, 20)), true);
  assert.equal(eventOverlapsDay(event, new Date(2026, 8, 21)), false);
  assert.notEqual(formatEventStart(event), "All day");
});

// ---------------------------------------------------------------------------
// Texting: every church texts from its own phone
// ---------------------------------------------------------------------------

type Row = { access_token: string | null; metadata: Record<string, unknown> } | null;

/** Just enough of a Supabase client for one `church_integrations` lookup. */
function clientReturning(rows: Record<string, Row>) {
  return {
    from() {
      const filters: Record<string, string> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => ({ data: rows[filters.church_id] ?? null, error: null }),
      };
      return chain;
    },
  } as unknown as Parameters<typeof getChurchSmsSender>[1];
}

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a church with its own phone texts from it", async () => {
  const client = clientReturning({
    grace: { access_token: "grace-key", metadata: { from_number: "+15025550134" } },
  });
  const sender = await withEnv(
    { SMS_MOBILE_API_KEY: "pastor-key", SMS_ENV_CHURCH_ID: "cornerstone" },
    () => getChurchSmsSender("grace", client),
  );
  assert.deepEqual(sender, {
    gateway: "smsmobileapi",
    apiKey: "grace-key",
    fromNumber: "+15025550134",
    deviceSid: null,
    source: "church",
  });
});

test("the server-wide phone only ever texts for the church it belongs to", async () => {
  const client = clientReturning({});
  await withEnv(
    { SMS_MOBILE_API_KEY: "pastor-key", SMS_MOBILE_API_NUMBER: "+15025559999", SMS_ENV_CHURCH_ID: "cornerstone" },
    async () => {
      const owner = await getChurchSmsSender("cornerstone", client);
      assert.equal(owner?.gateway, "smsmobileapi");
      assert.equal(owner?.source, "server");
      assert.equal(owner?.fromNumber, "+15025559999");
      assert.equal(owner?.deviceSid, null);

      // The bug: every other church used the same pastor's phone.
      assert.equal(await getChurchSmsSender("grace", client), null);
    },
  );

  // With no owner named, nobody gets the server-wide phone.
  const unowned = await withEnv(
    { SMS_MOBILE_API_KEY: "pastor-key", SMS_ENV_CHURCH_ID: undefined },
    () => getChurchSmsSender("cornerstone", client),
  );
  assert.equal(unowned, null);
});
