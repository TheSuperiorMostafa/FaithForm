import { existsSync } from "node:fs";
import path from "node:path";

export const pdfColors = {
  navy: "#002D5F",
  gold: "#C5A059",
  cream: "#F8F7F4",
  white: "#FFFFFF",
  muted: "#6B7280",
  border: "#DDD9D0",
  navyTint: "#E8EEF5",
  navyDark: "#001A3D",
} as const;

export const pdfSpacing = {
  page: 36,
  section: 20,
  block: 12,
  tight: 6,
} as const;

export const pdfFontSizes = {
  hero: 34,
  title: 14,
  subtitle: 10,
  body: 9,
  small: 8,
  kpi: 18,
} as const;

export const pageStyle = {
  paddingTop: pdfSpacing.page,
  paddingBottom: 52,
  paddingHorizontal: pdfSpacing.page,
  fontFamily: "Helvetica",
  fontSize: pdfFontSizes.body,
  color: pdfColors.navy,
  backgroundColor: pdfColors.cream,
};

export function logoPath(): string | null {
  const filePath = path.join(process.cwd(), "public/faithform-logo.png");
  return existsSync(filePath) ? filePath : null;
}
