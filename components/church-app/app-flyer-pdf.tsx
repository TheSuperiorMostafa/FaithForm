import React from "react";
import {
  Document,
  Image,
  Page,
  Path,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import {
  flyerColors,
  flyerCopy,
  qrPath,
} from "@/components/church-app/app-flyer-content";

export type AppFlyerInput = {
  churchName: string;
  primaryColor: string | null;
  accentColor: string | null;
  /** PNG bytes of the church logo, already fetched and re-encoded. */
  logoPng: Buffer | null;
  /** Whether people can find the church by searching in the app. */
  findableInSearch: boolean;
  /** What the QR code opens. */
  downloadUrl: string;
};

// US Letter, in points.
const PAGE_WIDTH = 612;
const BAND_HEIGHT = 330;
const QR_SIZE = 228;
const QUIET_ZONE = 4;

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", backgroundColor: "#FFFFFF", color: "#1F2937" },
  band: { height: BAND_HEIGHT, paddingTop: 46, paddingHorizontal: 48, alignItems: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 26 },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    padding: 5,
    marginRight: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 42, height: 42, objectFit: "contain" },
  churchName: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 1.2 },
  rule: { width: 56, height: 4, borderRadius: 2, marginBottom: 18 },
  headline: { fontSize: 42, fontFamily: "Helvetica-Bold", textAlign: "center", lineHeight: 1.1 },
  subhead: { fontSize: 15, textAlign: "center", lineHeight: 1.45, marginTop: 14, maxWidth: 480 },
  qrCard: {
    position: "absolute",
    top: BAND_HEIGHT - 62,
    left: (PAGE_WIDTH - (QR_SIZE + 44)) / 2,
    width: QR_SIZE + 44,
    padding: 22,
    paddingBottom: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 3,
    alignItems: "center",
  },
  scanLabel: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 10, letterSpacing: 0.4 },
  steps: { position: "absolute", top: BAND_HEIGHT + 256, left: 96, right: 96 },
  stepsTitle: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 14, color: "#111827" },
  step: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  stepText: { flex: 1, fontSize: 14, lineHeight: 1.4, paddingTop: 4, color: "#1F2937" },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0 },
  footerText: { fontSize: 11, textAlign: "center", color: "#4B5563", marginBottom: 14 },
  footerBar: { height: 12 },
});

function AppFlyer({ input }: { input: AppFlyerInput }) {
  const colors = flyerColors(input.primaryColor, input.accentColor);
  const copy = flyerCopy({ churchName: input.churchName, findableInSearch: input.findableInSearch });
  const qr = qrPath(input.downloadUrl);
  const box = qr.size + QUIET_ZONE * 2;
  const name = input.churchName.trim();

  return (
    <Document title={`${name || "Our church"} app flyer`} author={name || undefined}>
      <Page size="LETTER" style={styles.page}>
        <View style={[styles.band, { backgroundColor: colors.primary }]}>
          {(input.logoPng || name) && (
            <View style={styles.brandRow}>
              {input.logoPng && (
                <View style={styles.logoBox}>
                  {/* react-pdf's Image takes no alt text; the PDF is print-only. */}
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image style={styles.logo} src={{ data: input.logoPng, format: "png" }} />
                </View>
              )}
              {name && (
                <Text style={[styles.churchName, { color: colors.onPrimary }]}>{name.toUpperCase()}</Text>
              )}
            </View>
          )}
          <View style={[styles.rule, { backgroundColor: colors.accentOnPrimary }]} />
          <Text style={[styles.headline, { color: colors.onPrimary }]}>{copy.headline}</Text>
          <Text style={[styles.subhead, { color: colors.onPrimary }]}>{copy.subhead}</Text>
        </View>

        <View style={[styles.qrCard, { borderColor: colors.accentOnWhite }]}>
          <Svg width={QR_SIZE} height={QR_SIZE} viewBox={`0 0 ${box} ${box}`}>
            <Rect x={0} y={0} width={box} height={box} fill="#FFFFFF" />
            <Path
              d={qr.d}
              fill={colors.qrInk}
              transform={`translate(${QUIET_ZONE}, ${QUIET_ZONE})`}
            />
          </Svg>
          <Text style={[styles.scanLabel, { color: colors.qrInk }]}>SCAN TO GET THE APP</Text>
        </View>

        <View style={styles.steps}>
          <Text style={styles.stepsTitle}>How to get it</Text>
          {copy.steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <View style={[styles.stepNumber, { backgroundColor: colors.primary }]}>
                <Text style={[styles.stepNumberText, { color: colors.onPrimary }]}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{copy.storeLine}</Text>
          <View style={[styles.footerBar, { backgroundColor: colors.accentOnWhite }]} />
        </View>
      </Page>
    </Document>
  );
}

/** A one-page, letter-size flyer that invites the congregation into the app. */
export async function renderAppFlyerPdf(input: AppFlyerInput): Promise<Buffer> {
  return renderToBuffer(<AppFlyer input={input} />);
}
