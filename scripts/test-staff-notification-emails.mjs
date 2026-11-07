/**
 * Send three explicitly labelled test emails, without changing church data.
 * Run from the project root:
 *   node --import tsx scripts/test-staff-notification-emails.mjs --send
 * Omit --send to preview locally without making requests.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { Resend } from "resend";

const require = createRequire(import.meta.url);
const { renderEmail } = require("../lib/email/layout.ts");
const { resolveFromAddress } = require("../lib/email/sender.ts");
const { STAFF_NOTIFICATION_EVENTS } = require("../lib/notifications/staff-preferences.ts");

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    process.env[key] ??= value;
  }
}
// Test email links must open the live app, even when run on a developer's Mac.
process.env.NEXT_PUBLIC_SITE_URL = "https://faithform.io";

const recipient = "jb@faithform.io";
const send = process.argv.includes("--send");
if (send && !process.env.RESEND_API_KEY?.trim()) {
  throw new Error("RESEND_API_KEY is missing from the environment or .env.local.");
}
const resend = send ? new Resend(process.env.RESEND_API_KEY) : null;
const run = `staff-test-${crypto.randomUUID()}`;
let accepted = 0;

for (const event of STAFF_NOTIFICATION_EVENTS) {
  const body = event.id === "attendance_documents"
    ? "An attendance report is ready. Open Documents in FaithForm to download it."
    : event.id === "attendance_completed"
      ? "Your team saved weekly attendance. Open FaithForm to review it."
      : "The Kids desk requested a guardian. Open FaithForm to review the alert.";
  const path = event.id === "attendance_documents"
    ? "/dashboard/settings?tab=documents"
    : event.id === "attendance_completed" ? "/dashboard/attendance" : "/dashboard/checkin";
  const content = renderEmail({
    title: event.label,
    preheader: `TEST: ${body}`,
    heading: event.label,
    blocks: [
      { kind: "paragraph", text: "This is a requested test notification. No real attendance event or guardian request occurred." },
      { kind: "paragraph", text: body },
      { kind: "button", label: "Open FaithForm", url: `https://faithform.io${path}` },
    ],
    permissionNote: `You requested this notification test for ${recipient}.`,
  });
  if (!send) {
    console.log(`PREVIEW: [TEST] ${event.label} → ${recipient}\n${content.text}\n`);
    continue;
  }
  try {
    const result = await resend.emails.send({
      from: `FaithForm <${resolveFromAddress()}>`,
      to: recipient,
      subject: `[TEST] ${event.label}`,
      html: content.html,
      text: content.text,
    }, { idempotencyKey: `${run}-${event.id}` });
    if (result.error || !result.data?.id) {
      console.error(`FAILED: ${event.label}: ${result.error?.message ?? "No message ID returned"}`);
      process.exitCode = 1;
    } else {
      accepted++;
      console.log(`ACCEPTED: ${event.label}: ${result.data.id}`);
    }
  } catch (error) {
    console.error(`FAILED: ${event.label}: ${error.message}`);
    process.exitCode = 1;
  }
}
if (send) {
  console.log(`${accepted}/3 emails accepted by the provider. Inbox delivery is not yet confirmed.`);
  if (accepted === 0) {
    console.error("If requests cannot be resolved in Codex, run this same command in your Mac's Terminal to check outside the session's network restrictions.");
  }
}
