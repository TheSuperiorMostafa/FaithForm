import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { createDomainProbe, validDomainProof } from "./domain-probe-token";

export type DomainProbeResult = { ok: true } | { ok: false; code: "name_unavailable" | "unsafe_address" | "https_pending" | "wrong_website" | "website_unavailable" };

/** All resolved addresses must be public; pin the selected address for the TLS request.
 * The request never follows redirects, re-resolves DNS, sends cookies, or disables TLS.
 */
export function isPublicDomainAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) === 6) {
    // Global-unicast only. Excludes mapped IPv4, ULA, link-local, multicast,
    // documentation, benchmark, Teredo and 6to4 transition ranges.
    if (ip.includes(".") || ip.includes("%")) return false;
    const halves = ip.toLowerCase().split("::");
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
    const [first, second] = words.map(word => parseInt(word, 16));
    return words.length === 8 && first >= 0x2000 && first <= 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x2002 && first !== 0x3fff;
  }
  return false;
}
export type ProbeHttpResponse = { status: number; proof: string | null; location: string | null; body: string };
export type DomainProbeDependencies = {
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]>;
  request: (hostname: string, address: { address: string; family: number }, token: string) => Promise<ProbeHttpResponse>;
};
const defaults: DomainProbeDependencies = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  request: (hostname, address, token) => new Promise((resolve, reject) => {
    const request = https.request({
      hostname, port: 443, path: "/", method: "GET", servername: hostname,
      headers: { "x-faithform-domain-probe": token, "user-agent": "FaithForm-Domain-Check/1.0", accept: "text/html" },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      let body = "", size = 0;
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size <= 256 * 1024) body += chunk;
        if (size > 512 * 1024) response.destroy(new Error("probe_body_limit"));
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, proof: typeof response.headers["x-faithform-domain-proof"] === "string" ? response.headers["x-faithform-domain-proof"] : null, location: response.headers.location ?? null, body }));
    });
    const deadline = setTimeout(() => request.destroy(new Error("probe_timeout")), 8000);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", reject);
    request.end();
  }),
};
export async function probeChurchDomain(input: { hostname: string; slug: string; published: boolean; redirectTo?: string | null }, deps: DomainProbeDependencies = defaults): Promise<DomainProbeResult> {
  let addresses: { address: string; family: number }[];
  let resolutionDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([deps.resolve(input.hostname), new Promise<never>((_, reject) => {
      resolutionDeadline = setTimeout(() => reject(new Error("dns_timeout")), 4000);
    })]);
  } catch { return { ok: false, code: "name_unavailable" }; }
  finally { if (resolutionDeadline) clearTimeout(resolutionDeadline); }
  if (!addresses.length) return { ok: false, code: "name_unavailable" };
  if (addresses.some(item => !isPublicDomainAddress(item.address))) return { ok: false, code: "unsafe_address" };
  const token = await createDomainProbe(input.hostname);
  if (!token) return { ok: false, code: "website_unavailable" };
  let response: ProbeHttpResponse;
  try { response = await deps.request(input.hostname, addresses[0], token); } catch { return { ok: false, code: "https_pending" }; }
  if (input.redirectTo) {
    let destination: URL;
    try { destination = new URL(response.location ?? ""); } catch { return { ok: false, code: "wrong_website" }; }
    return input.hostname === `www.${input.redirectTo}` && !destination.username && !destination.password && [307, 308].includes(response.status) && destination.origin === `https://${input.redirectTo}` && destination.pathname === "/" && !destination.search && !destination.hash
      ? { ok: true } : { ok: false, code: "wrong_website" };
  }
  if (!(await validDomainProof(input.hostname, input.slug, token, response.proof))) return { ok: false, code: "wrong_website" };
  // App Router streams the loading shell before the completed church page.
  // A skeleton's data-site="loading" must not hide the actual tenant marker.
  const expectedPage = Array.from(response.body.matchAll(/\bdata-site=["\']([^"\']+)["\']/g)).some(match => match[1] === input.slug);
  if (response.status === 200) return expectedPage ? { ok: true } : { ok: false, code: "wrong_website" };
  return !input.published && response.status === 404 ? { ok: true } : { ok: false, code: "website_unavailable" };
}
