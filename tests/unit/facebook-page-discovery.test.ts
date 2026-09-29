import assert from "node:assert/strict";
import test from "node:test";

import { getFacebookAuthUrl } from "@/lib/integrations/facebook";
import { fetchFacebookPages } from "@/lib/integrations/facebook-token";

function withFacebookConfig(run: () => void) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI;
  process.env.FACEBOOK_APP_ID = "facebook-app";
  process.env.FACEBOOK_APP_SECRET = "facebook-secret";
  process.env.FACEBOOK_REDIRECT_URI = "https://faithform.test/facebook/callback";

  try {
    run();
  } finally {
    if (appId === undefined) delete process.env.FACEBOOK_APP_ID;
    else process.env.FACEBOOK_APP_ID = appId;
    if (appSecret === undefined) delete process.env.FACEBOOK_APP_SECRET;
    else process.env.FACEBOOK_APP_SECRET = appSecret;
    if (redirectUri === undefined) delete process.env.FACEBOOK_REDIRECT_URI;
    else process.env.FACEBOOK_REDIRECT_URI = redirectUri;
  }
}

test("Facebook reconnects re-request Page access and asks Facebook to return granted scopes", () => {
  withFacebookConfig(() => {
    const url = new URL(getFacebookAuthUrl("signed-state"));

    assert.equal(url.searchParams.get("auth_type"), "rerequest");
    assert.equal(url.searchParams.get("return_scopes"), "true");
    assert.equal(
      url.searchParams.get("scope"),
      "pages_show_list,pages_manage_posts,pages_read_engagement,business_management",
    );
  });
});

test("Facebook Page discovery checks Business Portfolio assignments after an empty managed-Page list", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return new Response(
      JSON.stringify(
        url.pathname.endsWith("/assigned_pages")
          ? {
              data: [
                { id: "somerset", name: "SFC NAZ", access_token: "page-token" },
              ],
            }
          : { data: [] },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const pages = await fetchFacebookPages("user-token");
    assert.deepEqual(pages, [
      { id: "somerset", name: "SFC NAZ", access_token: "page-token" },
    ]);
    assert.deepEqual(
      requests.map((url) => url.pathname),
      ["/v21.0/me/accounts", "/v21.0/me/assigned_pages"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Facebook Page discovery collects every response page and deduplicates Pages", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const after = url.searchParams.get("after");
    return new Response(
      JSON.stringify(
        after
          ? {
              data: [
                { id: "somerset", name: "Somerset Church", access_token: "page-token-2" },
              ],
            }
          : {
              data: [
                { id: "grace", name: "Grace Church", access_token: "page-token-1" },
              ],
              paging: { cursors: { after: "next-page" } },
            },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const pages = await fetchFacebookPages("user-token");
    assert.deepEqual(
      pages.map(({ id, name }) => ({ id, name })),
      [
        { id: "grace", name: "Grace Church" },
        { id: "somerset", name: "Somerset Church" },
      ],
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get("limit"), "100");
    assert.equal(requests[1].searchParams.get("after"), "next-page");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
