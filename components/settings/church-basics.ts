import type { ChurchAppInfo, ChurchAppServiceTime } from "@/lib/queries/church-app-info";

/**
 * The part of the church profile Settings › Church info edits. Everything
 * else on the church page (tagline, about, social and quick links) stays on
 * the App page and is never touched from here.
 */
export type ChurchBasics = Pick<
  ChurchAppInfo,
  "name" | "address" | "city" | "state" | "zip" | "phone" | "email"
> & {
  serviceTimes: ChurchAppServiceTime[];
};

export function pickChurchBasics(info: ChurchAppInfo): ChurchBasics {
  return {
    name: info.name,
    address: info.address,
    city: info.city,
    state: info.state,
    zip: info.zip,
    phone: info.phone,
    email: info.email,
    serviceTimes: info.serviceTimes,
  };
}

/** Only these fields may overwrite the saved profile when Settings saves. */
export function mergeChurchBasics(current: ChurchAppInfo, input: ChurchBasics): ChurchAppInfo {
  return {
    ...current,
    name: String(input.name ?? ""),
    address: String(input.address ?? ""),
    city: String(input.city ?? ""),
    state: String(input.state ?? ""),
    zip: String(input.zip ?? ""),
    phone: String(input.phone ?? ""),
    email: String(input.email ?? ""),
    serviceTimes: Array.isArray(input.serviceTimes) ? input.serviceTimes : current.serviceTimes,
  };
}

/** A validation failure on one of these fields is shown beside the field. */
export function isChurchBasicsField(field: string | undefined): boolean {
  return Boolean(field && /^(name|address|city|state|zip|phone|email|serviceTimes(\.|$))/.test(field));
}
