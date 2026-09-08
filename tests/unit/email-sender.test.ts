import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_FROM_ADDRESS,
  isSandboxSender,
  resolveFromAddress,
} from "@/lib/email/sender";

function withEnv(value: string | undefined, run: () => void): void {
  const previous = process.env.RESEND_FROM_EMAIL;
  const previousWarn = console.warn;
  console.warn = () => {};
  if (value === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = value;
  try {
    run();
  } finally {
    console.warn = previousWarn;
    if (previous === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous;
  }
}

test("a real configured sender is used as given", () => {
  withEnv("hello@faithform.io", () => {
    assert.equal(resolveFromAddress(), "hello@faithform.io");
  });
});

/**
 * The bug this file exists for: the sandbox sender reached production as an env
 * override, Resend restricted it to the account owner, and every church invite
 * silently reached nobody but us.
 */
test("Resend's sandbox sender is ignored, not obeyed", () => {
  withEnv("onboarding@resend.dev", () => {
    assert.equal(resolveFromAddress(), DEFAULT_FROM_ADDRESS);
  });
});

test("any mailbox on the sandbox domain is refused, not just the usual one", () => {
  for (const address of [
    "onboarding@resend.dev",
    "anything@resend.dev",
    "ONBOARDING@RESEND.DEV",
    "  onboarding@resend.dev  ",
    "test@mail.resend.dev",
  ]) {
    withEnv(address, () => {
      assert.equal(resolveFromAddress(), DEFAULT_FROM_ADDRESS, address);
    });
  }
});

test("a lookalike domain we might genuinely own is not caught", () => {
  withEnv("noreply@resend.dev.faithform.io", () => {
    assert.equal(resolveFromAddress(), "noreply@resend.dev.faithform.io");
  });
  assert.equal(isSandboxSender("noreply@notresend.dev"), false);
});

test("blank or absent falls back", () => {
  for (const value of [undefined, "", "   "]) {
    withEnv(value, () => {
      assert.equal(resolveFromAddress(), DEFAULT_FROM_ADDRESS);
    });
  }
});

/**
 * Five modules each had their own copy of this fallback, with two different
 * spellings of it. A sixth would have had a third.
 */
test("every email module resolves its sender through one place", () => {
  const offenders: string[] = [];
  for (const file of readdirSync("lib/email")) {
    if (!file.endsWith(".ts") || file === "sender.ts") continue;
    const source = readFileSync(`lib/email/${file}`, "utf8");
    if (source.includes("RESEND_FROM_EMAIL")) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `these read RESEND_FROM_EMAIL directly instead of calling resolveFromAddress(): ${offenders.join(", ")}`,
  );
});
