/**
 * A small CalDAV client, sized for iCloud.
 *
 * Everything here is deliberately dependency-free and tolerant: responses are
 * WebDAV multistatus XML whose namespace prefixes differ between servers, so
 * elements are matched by local name rather than parsed into a full DOM.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export class CalDavAuthError extends Error {
  constructor(message = "Apple rejected that Apple ID or app-specific password.") {
    super(message);
    this.name = "CalDavAuthError";
  }
}

export class CalDavError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CalDavError";
  }
}

export type CalDavCredentials = {
  username: string;
  password: string;
};

function authHeader(credentials: CalDavCredentials): string {
  const raw = `${credentials.username}:${credentials.password}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * Makes an ETag safe to send back in `If-Match`.
 *
 * The header already arrives quoted (`"C=12@U=abc"`, or `W/"…"` when weak), and
 * must go back exactly as it came. Quoting it a second time produced
 * `""C=12@U=abc""`, which matches nothing, so iCloud answered every edit with
 * 412 and FaithForm reported a conflict that never happened.
 */
export function toEntityTag(etag: string): string {
  const trimmed = etag.trim();
  if (/^(W\/)?".*"$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/^"|"$/g, "")}"`;
}

export async function calDavRequest(
  url: string,
  credentials: CalDavCredentials,
  init: {
    method: string;
    body?: string;
    depth?: "0" | "1";
    contentType?: string;
    headers?: Record<string, string>;
    /**
     * Which other hosts a redirect may lead to. Same-origin redirects are
     * always followed; anything else is refused unless this says yes, because
     * the login travels with every hop.
     */
    followRedirect?: (target: URL) => boolean;
  },
): Promise<{ status: number; text: string; etag: string | null }> {
  let target = url;
  let method = init.method;
  let body = init.body;
  let response: Response;

  // Redirects are followed by hand. Left to fetch, a hop to another host
  // silently drops the Authorization header, and iCloud moves accounts between
  // its partition hosts: the request arrives with no login, comes back 401, and
  // a correct password gets treated as a wrong one.
  for (let hop = 0; ; hop += 1) {
    try {
      response = await fetch(target, {
        method,
        headers: {
          Authorization: authHeader(credentials),
          "Content-Type": init.contentType ?? 'application/xml; charset="utf-8"',
          ...(init.depth ? { Depth: init.depth } : {}),
          ...(init.headers ?? {}),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new CalDavError(
        timedOut
          ? "iCloud did not answer in time. Try again in a moment."
          : "Could not reach iCloud.",
      );
    }

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;

    const next = new URL(location, target);
    const sameOrigin = next.origin === new URL(target).origin;
    if (
      hop >= MAX_REDIRECTS ||
      next.protocol !== "https:" ||
      !(sameOrigin || init.followRedirect?.(next))
    ) {
      throw new CalDavError(
        "iCloud redirected the request somewhere FaithForm will not send your login.",
        response.status,
      );
    }

    // 303 means "fetch the answer from over there"; every other redirect
    // repeats the same request, PROPFIND and REPORT bodies included.
    if (response.status === 303) {
      method = "GET";
      body = undefined;
    }
    target = next.toString();
  }

  // Only 401 means the login itself was refused. A 403 is iCloud declining one
  // particular thing, such as writing to a calendar shared read-only. Treating
  // it as a bad password wiped a working connection on the first such refusal.
  if (response.status === 401) {
    throw new CalDavAuthError();
  }

  const text = await response.text();

  if (response.status === 403) {
    throw new CalDavError(
      "iCloud would not allow that (403). The calendar may be read-only for this Apple ID.",
      403,
    );
  }

  if (response.status >= 400) {
    throw new CalDavError(
      `iCloud refused the request (${response.status}).`,
      response.status,
    );
  }

  return {
    status: response.status,
    text,
    etag: response.headers.get("etag"),
  };
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

/** Matches an element by local name, whatever namespace prefix it carries. */
function elementPattern(localName: string, flags = "i"): RegExp {
  return new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${localName}>`,
    flags,
  );
}

function firstElement(xml: string, localName: string): string | null {
  const match = xml.match(elementPattern(localName));
  return match ? (match[1] ?? "") : null;
}

export type MultiStatusResponse = {
  href: string;
  etag: string | null;
  /** Raw inner XML, for callers that need more than href and etag. */
  body: string;
};

export function parseMultiStatus(xml: string): MultiStatusResponse[] {
  const responses: MultiStatusResponse[] = [];
  const pattern = elementPattern("response", "gi");

  for (const match of xml.matchAll(pattern)) {
    const body = match[1] ?? "";
    const href = firstElement(body, "href");
    if (href === null) continue;
    responses.push({
      href: decodeXmlText(href.trim()),
      etag: firstElement(body, "getetag")?.trim().replace(/^"|"$/g, "") ?? null,
      body,
    });
  }

  return responses;
}

export function responseProperty(
  response: MultiStatusResponse,
  localName: string,
): string | null {
  const value = firstElement(response.body, localName);
  return value === null ? null : decodeXmlText(value);
}

/** Resolves an href from a multistatus body against the URL it came from. */
export function absoluteHref(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
