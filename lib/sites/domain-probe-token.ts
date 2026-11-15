/** Short-lived internal probes can test a reserved address without publishing drafts. */
const encoder = new TextEncoder();
function secret(): string | undefined {
  return process.env.DOMAIN_PROBE_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}
async function mac(message: string): Promise<string | null> {
  const value = secret();
  if (!value) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("");
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
export async function createDomainProbe(hostname: string, now = Date.now()): Promise<string | null> {
  const value = `${Math.floor(now / 1000)}.${crypto.randomUUID()}`;
  const signature = await mac(`request\n${hostname}\n${value}`);
  return signature ? `${value}.${signature}` : null;
}
export async function validDomainProbe(hostname: string, token: string | null, now = Date.now()): Promise<boolean> {
  if (!token || !/^\d{10}\.[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(token)) return false;
  const [time, nonce, signature] = token.split(".");
  const age = now / 1000 - Number(time);
  if (age < -10 || age > 120) return false;
  const expected = await mac(`request\n${hostname}\n${time}.${nonce}`);
  return expected !== null && equal(expected, signature);
}
export async function domainProbeProof(hostname: string, slug: string, token: string): Promise<string | null> {
  return mac(`response\n${hostname}\n${slug}\n${token}`);
}
export async function validDomainProof(hostname: string, slug: string, token: string, proof: string | null): Promise<boolean> {
  if (!proof || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = await domainProbeProof(hostname, slug, token);
  return expected !== null && equal(expected, proof);
}
