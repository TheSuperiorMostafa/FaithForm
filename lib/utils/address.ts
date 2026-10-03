export function formatAddressLine(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const street = parts.address?.trim() ?? "";
  const city = parts.city?.trim() ?? "";
  const stateZip = [parts.state?.trim(), parts.zip?.trim()].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}
