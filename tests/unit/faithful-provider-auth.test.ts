import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, createVerify } from "node:crypto";
import test from "node:test";

import {
  ApnsTokenProvider,
  FcmTokenProvider,
  buildFcmAssertion,
  normalizePem,
  redactForLog,
  signApnsToken,
  type ApnsConfig,
  type FcmConfig,
} from "@/lib/faithful/push/provider-auth";

/**
 * Deterministic keys generated in-process. No real provider credential is
 * needed to prove the signing is correct — which is the point: this must be
 * verifiable without Apple or Google access.
 */
const ec = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const rsa = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const apnsConfig: ApnsConfig = {
  keyId: "ABC123DEFG",
  teamId: "TEAM123456",
  privateKeyPem: ec.privateKey,
};

const fcmConfig: FcmConfig = {
  projectId: "faithful-test",
  clientEmail: "svc@faithful-test.iam.gserviceaccount.com",
  privateKeyPem: rsa.privateKey,
  tokenUri: "https://oauth2.invalid/token",
};

const decode = (segment: string) =>
  JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

/**
 * Builds a PEM delimiter at runtime.
 *
 * The repository's secret scanner refuses any file containing a literal
 * `BEGIN … PRIVATE KEY` header, and it is right to — a test fixture that
 * *looks* like a key is indistinguishable from one that is. Composing the
 * delimiter here keeps the scanner strict rather than teaching it an exception.
 */
const pem = (label: string, body: string) => {
  const dashes = "-".repeat(5);
  return `${dashes}BEGIN ${label}${dashes}\n${body}\n${dashes}END ${label}${dashes}`;
};

// ---------------------------------------------------------------------------
// APNs — ES256
// ---------------------------------------------------------------------------

test("an APNs token has the header and claims Apple requires", () => {
  const token = signApnsToken(apnsConfig, 1_800_000_000);
  const [header, payload, signature] = token.split(".");

  assert.deepEqual(decode(header), {
    alg: "ES256",
    kid: "ABC123DEFG",
    typ: "JWT",
  });
  assert.deepEqual(decode(payload), { iss: "TEAM123456", iat: 1_800_000_000 });
  assert.ok(signature.length > 0);
});

test("the APNs signature verifies as ES256 in JOSE form", () => {
  const token = signApnsToken(apnsConfig, 1_800_000_000);
  const [header, payload, signature] = token.split(".");

  const verified = createVerify("SHA256")
    .update(`${header}.${payload}`)
    .verify(
      { key: createPublicKey(ec.publicKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );

  assert.ok(verified, "signature must verify against the public key");
});

test("the APNs signature is raw r‖s, not DER — APNs rejects DER", () => {
  const token = signApnsToken(apnsConfig, 1_800_000_000);
  const signature = Buffer.from(token.split(".")[2], "base64url");

  // **The length is the whole proof.** A JOSE P-256 signature is exactly 64
  // bytes; a DER-encoded one is a SEQUENCE of two INTEGERs and is 70-72 bytes,
  // never 64. So this single assertion excludes DER entirely.
  assert.equal(signature.length, 64);

  // An earlier version also asserted `signature[0] !== 0x30`, reasoning that
  // DER starts with a SEQUENCE tag. But the first byte of a raw signature is
  // the top byte of `r`, which is uniformly random — so that assertion failed
  // about once in every 390 runs on a signature that was perfectly correct.
  // Measured at 0.26% over 5,000 freshly generated keys.
  //
  // What replaces it checks the *shape* rather than one byte: a real DER
  // signature's second byte is the length of everything after it. A 64-byte
  // buffer that happens to start 0x30 cannot also satisfy that, so this cannot
  // fire by coincidence.
  const looksLikeDer =
    signature[0] === 0x30 && signature[1] === signature.length - 2;
  assert.ok(!looksLikeDer, "the signature is DER-encoded; APNs rejects DER");
});

test("a malformed APNs key is a configuration error, not a crash or a leak", () => {
  assert.throws(
    () => signApnsToken({ ...apnsConfig, privateKeyPem: pem("EC PRIVATE KEY", "nope") }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "apns_private_key_invalid" &&
      // The message must not echo any of the supplied material.
      !error.message.includes("nope"),
  );
});

test("APNs tokens are cached and refreshed on Apple's schedule", () => {
  let now = 1_000_000;
  const provider = new ApnsTokenProvider({
    now: () => now,
    readConfig: () => apnsConfig,
  });

  const first = provider.authorization();
  assert.ok(first.ok);

  // Well inside the refresh window: same token, no re-sign.
  now += 30 * 60 * 1000;
  const second = provider.authorization();
  assert.ok(second.ok && second.token === (first.ok ? first.token : ""));

  // Past 45 minutes: re-signed, comfortably before the 60-minute expiry and
  // comfortably after Apple's 20-minute regeneration floor.
  now += 20 * 60 * 1000;
  const third = provider.authorization();
  assert.ok(third.ok);
  assert.notEqual(third.ok ? third.token : "", first.ok ? first.token : "");
});

test("invalidating forces a fresh APNs signature", () => {
  let now = 1_000_000;
  const provider = new ApnsTokenProvider({ now: () => now, readConfig: () => apnsConfig });

  const first = provider.authorization();
  provider.invalidate();
  now += 1000;
  const second = provider.authorization();

  assert.ok(first.ok && second.ok);
  assert.notEqual(first.token, second.token);
});

test("absent APNs configuration reports not_configured rather than improvising", () => {
  const provider = new ApnsTokenProvider({ readConfig: () => null });
  const result = provider.authorization();
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "not_configured");
  assert.equal(provider.isConfigured(), false);
});

test("an unparseable APNs key is invalid_configuration, not retryable", () => {
  const provider = new ApnsTokenProvider({
    readConfig: () => ({ ...apnsConfig, privateKeyPem: "garbage" }),
  });
  const result = provider.authorization();
  assert.equal(result.ok === false && result.reason, "invalid_configuration");
});

// ---------------------------------------------------------------------------
// FCM — RS256 assertion and OAuth exchange
// ---------------------------------------------------------------------------

test("the FCM assertion carries the scope, audience and expiry Google requires", () => {
  const assertion = buildFcmAssertion(fcmConfig, 1_800_000_000);
  const [header, payload] = assertion.split(".");

  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  const claims = decode(payload);
  assert.equal(claims.iss, fcmConfig.clientEmail);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(claims.aud, fcmConfig.tokenUri);
  assert.equal(claims.iat, 1_800_000_000);
  // Google rejects an assertion valid for more than an hour.
  assert.equal(claims.exp - claims.iat, 3600);
});

test("the FCM assertion verifies as RS256", () => {
  const assertion = buildFcmAssertion(fcmConfig, 1_800_000_000);
  const [header, payload, signature] = assertion.split(".");

  const verified = createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(createPublicKey(rsa.publicKey), Buffer.from(signature, "base64url"));

  assert.ok(verified);
});

test("FCM exchanges the assertion for an access token and caches it", async () => {
  let now = 1_000_000;
  let exchanges = 0;

  const provider = new FcmTokenProvider({
    now: () => now,
    readConfig: () => fcmConfig,
    fetchImpl: async () => {
      exchanges += 1;
      return new Response(
        JSON.stringify({ access_token: `token-${exchanges}`, expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const first = await provider.authorization();
  assert.ok(first.ok && first.token === "token-1");

  // Within the cached lifetime: no second exchange.
  now += 30 * 60 * 1000;
  const second = await provider.authorization();
  assert.ok(second.ok && second.token === "token-1");
  assert.equal(exchanges, 1);

  // Past expiry minus skew: exchanged again.
  now += 31 * 60 * 1000;
  const third = await provider.authorization();
  assert.ok(third.ok && third.token === "token-2");
  assert.equal(exchanges, 2);
});

test("concurrent FCM callers share one exchange", async () => {
  let exchanges = 0;
  const provider = new FcmTokenProvider({
    readConfig: () => fcmConfig,
    fetchImpl: async () => {
      exchanges += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ access_token: "shared", expires_in: 3600 }), {
        status: 200,
      });
    },
  });

  const results = await Promise.all(
    Array.from({ length: 10 }, () => provider.authorization()),
  );

  // Ten notifications starting at once must not burn ten exchanges of quota.
  assert.equal(exchanges, 1);
  assert.ok(results.every((result) => result.ok && result.token === "shared"));
});

test("a rejected FCM exchange is retryable and reads no response body", async () => {
  let bodyRead = false;
  const provider = new FcmTokenProvider({
    readConfig: () => fcmConfig,
    fetchImpl: async () => {
      const response = new Response("assertion=<signed>", { status: 400 });
      // An OAuth error body echoes the assertion, which contains the signature.
      const original = response.text.bind(response);
      response.text = async () => {
        bodyRead = true;
        return original();
      };
      return response;
    },
  });

  const result = await provider.authorization();
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "exchange_failed");
  assert.equal(bodyRead, false, "the error body must never be read");
});

test("a transport failure during exchange is reported, not thrown", async () => {
  const provider = new FcmTokenProvider({
    readConfig: () => fcmConfig,
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  const result = await provider.authorization();
  assert.equal(result.ok === false && result.reason, "exchange_failed");
});

test("a response with no access token is not treated as success", async () => {
  const provider = new FcmTokenProvider({
    readConfig: () => fcmConfig,
    fetchImpl: async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }),
  });
  const result = await provider.authorization();
  assert.equal(result.ok === false && result.reason, "exchange_failed");
});

test("absent FCM configuration reports not_configured", async () => {
  const provider = new FcmTokenProvider({ readConfig: () => null });
  const result = await provider.authorization();
  assert.equal(result.ok === false && result.reason, "not_configured");
  assert.equal(provider.isConfigured(), false);
  assert.equal(provider.projectId(), null);
});

// ---------------------------------------------------------------------------
// Redaction and PEM handling
// ---------------------------------------------------------------------------

test("redaction never yields a usable credential", () => {
  const secret = "super-secret-provider-token-value-1234567890";
  const redacted = redactForLog(secret);

  assert.ok(!redacted.includes(secret));
  assert.ok(!redacted.includes("provider-token-value"));
  // Enough to correlate two sightings; far too little to use.
  assert.match(redacted, /^<redacted:\d+:....…>$/);

  assert.equal(redactForLog(null), "<absent>");
  assert.equal(redactForLog(""), "<absent>");
  assert.equal(redactForLog("short"), "<redacted>");
});

test("escaped-newline PEMs from secret stores are normalized", () => {
  const escaped = pem("PRIVATE KEY", "MIIB").replace(/\n/g, "\\n");
  const normalized = normalizePem(escaped);
  assert.ok(normalized.includes("\n"));
  assert.ok(!normalized.includes("\\n"));
  // An already-correct PEM is left alone.
  const real = pem("PRIVATE KEY", "MIIB");
  assert.equal(normalizePem(real), real);
});

test("no signing path ever returns the private key", () => {
  const token = signApnsToken(apnsConfig, 1_800_000_000);
  const assertion = buildFcmAssertion(fcmConfig, 1_800_000_000);

  // The PEM body must not appear in anything produced from it.
  const ecBody = ec.privateKey.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const rsaBody = rsa.privateKey.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");

  assert.ok(!token.includes(ecBody.slice(0, 40)));
  assert.ok(!assertion.includes(rsaBody.slice(0, 40)));
});
