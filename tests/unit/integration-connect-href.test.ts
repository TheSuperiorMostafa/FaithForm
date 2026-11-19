import assert from "node:assert/strict";
import { test } from "node:test";

import { integrationConnectHref } from "@/lib/integrations/connect-href";

test("reconnect links start the provider sign-in and return to the page", () => {
  assert.equal(
    integrationConnectHref("facebook", "/dashboard/live-streaming/setup"),
    "/api/integrations/facebook/connect?return_to=%2Fdashboard%2Flive-streaming%2Fsetup",
  );
  assert.equal(
    integrationConnectHref("google", "/dashboard/announcements?date=2026-11-19"),
    "/api/integrations/google/connect?return_to=%2Fdashboard%2Fannouncements%3Fdate%3D2026-11-19",
  );
});

test("off-site or missing return paths are dropped", () => {
  assert.equal(integrationConnectHref("youtube", "//evil.example"), "/api/integrations/youtube/connect");
  assert.equal(integrationConnectHref("youtube", "https://evil.example"), "/api/integrations/youtube/connect");
  assert.equal(integrationConnectHref("youtube", null), "/api/integrations/youtube/connect");
});
