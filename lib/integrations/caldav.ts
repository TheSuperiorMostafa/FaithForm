/**
 * A small CalDAV client, sized for iCloud.
 *
 * Everything here is deliberately dependency-free and tolerant: responses are
 * WebDAV multistatus XML whose namespace prefixes differ between servers, so
 * elements are matched by local name rather than parsed into a full DOM.
 */

const REQUEST_TIMEOUT_MS = 15_000;

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

export async function calDavRequest(
  url: string,
  credentials: CalDavCredentials,
  init: {
    method: string;
    body?: string;
    depth?: "0" | "1";
    contentType?: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; text: string; etag: string | null }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: authHeader(credentials),
        "Content-Type": init.contentType ?? 'application/xml; charset="utf-8"',
        ...(init.depth ? { Depth: init.depth } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body,
      redirect: "follow",
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

  if (response.status === 401 || response.status === 403) {
    throw new CalDavAuthError();
  }

  const text = await response.text();

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
