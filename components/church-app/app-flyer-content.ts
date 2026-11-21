import QRCode from "qrcode";

import { marketingConfig } from "@/components/marketing/config";
import { DEFAULT_BRAND } from "@/lib/branding/brand-colors";
import { absoluteAppPath } from "@/lib/site-url";

/**
 * Everything the "Get the app" QR code and flyer say and look like, kept free
 * of rendering so it can be tested on its own.
 *
 * The QR code points at FaithForm's own `/api/church-app/get` rather than
 * straight at a store listing. A flyer stays on a church wall for months, and
 * this keeps every printed code working when the Android app reaches Google
 * Play: only `marketingConfig.androidStore` has to change.
 */
export const APP_DOWNLOAD_PATH = "/api/church-app/get";

/** The address inside every QR code and flyer. */
export function appDownloadUrl(): string {
  return absoluteAppPath(APP_DOWNLOAD_PATH);
}

/** Where a phone that scanned the code is sent. */
export function appStoreDestination(userAgent: string | null | undefined): string {
  const agent = userAgent ?? "";
  const android = marketingConfig.androidStore;
  if (android && /android/i.test(agent)) return android;
  return marketingConfig.appStore;
}

const HEX = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(value: string | null | undefined, fallback: string): string {
  const match = HEX.exec((value ?? "").trim());
  return match ? `#${match[1].toUpperCase()}` : fallback;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const WHITE = "#FFFFFF";
const INK = "#111827";

export type FlyerColors = {
  /** The church's main app color: the flyer's top band and step numbers. */
  primary: string;
  /** The church's second app color: the thin rule and highlight line. */
  accent: string;
  /** Text that sits on the primary band. */
  onPrimary: string;
  /** The highlight line on the primary band, or plain text when the accent is too faint there. */
  accentOnPrimary: string;
  /** The accent where it sits on white (card frame, bottom bar), or a stand-in when it would vanish. */
  accentOnWhite: string;
  /** QR modules on white: the primary color when phones can still read it, otherwise near-black. */
  qrInk: string;
};

/**
 * The church's app colors (Church App → App colors), made safe to print.
 *
 * Text colors are picked for contrast rather than trusted, so a church that
 * chose a pale primary still gets a readable flyer and a scannable code.
 */
export function flyerColors(
  primaryColor: string | null | undefined,
  accentColor: string | null | undefined,
): FlyerColors {
  const primary = normalizeHex(primaryColor, DEFAULT_BRAND.primary);
  const accent = normalizeHex(accentColor, DEFAULT_BRAND.accent);
  const onPrimary = contrastRatio(primary, WHITE) >= contrastRatio(primary, INK) ? WHITE : INK;
  return {
    primary,
    accent,
    onPrimary,
    accentOnPrimary: contrastRatio(accent, primary) >= 3 ? accent : onPrimary,
    accentOnWhite:
      contrastRatio(accent, WHITE) >= 1.6
        ? accent
        : contrastRatio(primary, WHITE) >= 1.6
          ? primary
          : "#D1D5DB",
    // Scanners need a strong dark-on-light code; 4.5:1 keeps a safe margin.
    qrInk: contrastRatio(primary, WHITE) >= 4.5 ? primary : INK,
  };
}

/** The app's name in the App Store and Google Play. */
export const APP_STORE_NAME = "FaithForm Connect";

export type FlyerCopy = {
  headline: string;
  subhead: string;
  steps: string[];
  storeLine: string;
};

/**
 * The flyer's words. When the church can't be found in app search (hidden, or
 * invitation only), the last step sends people to the church for a link
 * instead of promising a search that would come up empty.
 */
export function flyerCopy({
  churchName,
  findableInSearch,
}: {
  churchName: string;
  findableInSearch: boolean;
}): FlyerCopy {
  const name = churchName.trim() || "our church";
  return {
    headline: "Our church has an app",
    subhead: "Watch services, join groups, give and stay up to date.",
    steps: [
      "Open your phone's camera and point it at the code.",
      `Tap the link that appears, then download ${APP_STORE_NAME}. It's free.`,
      findableInSearch
        ? `Open ${APP_STORE_NAME}, search for ${name}, and add our church.`
        : `Open ${APP_STORE_NAME} and ask us for an invitation link to add our church.`,
    ],
    storeLine: `Look for ${APP_STORE_NAME} on the App Store.`,
  };
}

export type QrMatrix = { size: number; isDark: (row: number, col: number) => boolean };

export function qrMatrix(text: string): QrMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = code.modules;
  return { size, isDark: (row, col) => Boolean(data[row * size + col]) };
}

/**
 * The code's dark modules as one SVG path, in module units, with each
 * horizontal run merged into a single rectangle. Shared by the SVG download
 * and the PDF so both print crisp at any size.
 */
export function qrPath(text: string): { size: number; d: string } {
  const { size, isDark } = qrMatrix(text);
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && isDark(row, col)) col += 1;
      parts.push(`M${start} ${row}h${col - start}v1h${start - col}z`);
    }
  }
  return { size, d: parts.join("") };
}

/** A standalone SVG with the standard four-module quiet zone. */
export function qrSvg(text: string, ink: string = INK): string {
  const { size, d } = qrPath(text);
  const quiet = 4;
  const total = size + quiet * 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="1024" height="1024" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="#FFFFFF"/>`,
    `<path transform="translate(${quiet} ${quiet})" fill="${normalizeHex(ink, INK)}" d="${d}"/>`,
    `</svg>`,
  ].join("");
}

/** "Grace Fellowship!" → "grace-fellowship", for download file names. */
export function fileStem(churchName: string): string {
  const stem = churchName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return stem || "church";
}

/**
 * True only for logos FaithForm itself stores (the church's uploads in our
 * public storage). A logo typed in as an outside link is left off the flyer
 * rather than fetched from an arbitrary address on the server.
 */
export function isOwnStorageImage(url: string, storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  if (!storageBase) return false;
  try {
    const parsed = new URL(url);
    const base = new URL(storageBase);
    return (
      parsed.protocol === "https:" &&
      parsed.origin === base.origin &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}
