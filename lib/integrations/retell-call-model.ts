/** Retell phone calls have E.164 endpoints; browser/simulation calls do not. */
export function isRealPhoneNumber(value: unknown): value is string {
  if (typeof value !== "string" || !/^[+\d\s().-]+$/.test(value)) return false;
  const normalized = value.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized)
    || /^[2-9]\d{9}$/.test(normalized)
    || /^1[2-9]\d{9}$/.test(normalized);
}

export type RetellCallEvent = "call_started" | "call_ended" | "call_analyzed";

export function isRealRetellPhoneCall(call: {
  call_type?: string;
  from_number?: string;
  to_number?: string;
}): boolean {
  return call.call_type === "phone_call" && isRealPhoneNumber(call.from_number)
    && isRealPhoneNumber(call.to_number);
}

export function isVisiblePhoneCall(call: {
  caller_number?: string | null;
  provider_call_type?: string | null;
}): boolean {
  return (call.provider_call_type == null || call.provider_call_type === "phone_call")
    && isRealPhoneNumber(call.caller_number);
}

export function isCompletedPhoneCall(call: {
  caller_number?: string | null;
  provider_call_type?: string | null;
  call_status?: string | null;
}): boolean {
  return isVisiblePhoneCall(call) && call.call_status !== "ongoing";
}
