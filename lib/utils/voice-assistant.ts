export function formatCallDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function maskPhoneNumber(number: string | null): string {
  if (!number) return "Unknown caller";
  const digits = number.replace(/\D/g, "");
  if (digits.length < 4) return number;
  return `••• ••• ${digits.slice(-4)}`;
}
