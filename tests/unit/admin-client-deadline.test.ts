import assert from "node:assert/strict";
import test from "node:test";
import { createAdminClient } from "@/lib/supabase/admin";

test("maintenance client combines shared deadline with caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faithform-test.invalid";
  process.env.SUPABASE_SECRET_KEY = "test-only-key";
  const observed: AbortSignal[] = [];
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal);
    const signal = init.signal;
    observed.push(signal);
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  };
  try {
    for (const cancel of ["caller", "deadline"]) {
      const deadline = new AbortController();
      const caller = new AbortController();
      const client = createAdminClient({ signal: deadline.signal });
      const pending = Promise.resolve(client.from("churches").select("id").abortSignal(caller.signal));
      await new Promise(resolve => setImmediate(resolve));
      (cancel === "caller" ? caller : deadline).abort();
      const result = await pending;
      assert.ok(result.error);
      assert.equal(observed.at(-1)?.aborted, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});
