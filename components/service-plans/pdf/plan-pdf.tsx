import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

import { formatClockTime, formatDuration, formatPlanDate } from "@/lib/service-plans/timing";
import { SHARE_PRESET_LABELS } from "@/lib/service-plans/types";
import type { PlanView, PlanViewNote, PlanViewRow } from "@/lib/service-plans/view";

/**
 * The printed plan. Everything it shows comes from `buildPlanView`, so the
 * start times, the rows a person or team sees and the notes they may read are
 * decided there, never here.
 *
 * Built for a black-and-white office printer: section rows are shaded but
 * also bold, bordered and capitalised, so nothing depends on colour alone.
 */

const FONT = "Montserrat";
let fontsRegistered = false;

/** Montserrat (OFL), read from `public/fonts/montserrat`. Safe to call repeatedly. */
export function registerPlanPdfFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const dir = path.join(process.cwd(), "public", "fonts", "montserrat");
  Font.register({
    family: FONT,
    fonts: [
      { src: path.join(dir, "Montserrat-Regular.woff"), fontWeight: 400 },
      { src: path.join(dir, "Montserrat-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(dir, "Montserrat-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Names, song titles and notes must never be split with a hyphen.
  Font.registerHyphenationCallback((word) => [word]);
}

registerPlanPdfFonts();

const NAVY = "#002D5F";
const GOLD = "#C5A059";
const INK = "#111827";
const MUTED = "#4B5563";
const RULE = "#9CA3AF";
const HAIRLINE = "#D1D5DB";
const MARGIN = 36;
const FOOTER_HEIGHT = 22;
const LH = 1.35;

export type PlanPdfBrand = { primary?: string | null; accent?: string | null };
export type PlanPdfOrientation = "portrait" | "landscape";

export type PlanPdfDocumentProps = {
  view: PlanView;
  churchName: string;
  /** A data URI or file path for a PNG/JPEG logo; remote URLs are resolved by the caller. */
  logoSrc?: string | null;
  timeZone: string;
  generatedAt: Date;
  brand?: PlanPdfBrand;
  orientation?: PlanPdfOrientation;
  /** Who this copy is for, e.g. "Worship team" or "For Jane Smith". */
  audience?: string | null;
};

function hex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  return null;
}

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The church's colours, when given and usable. Section rows carry white text,
 * so a primary colour too light to read white on (contrast under 4.5:1) keeps
 * the FaithForm navy instead.
 */
export function planPdfColors(brand?: PlanPdfBrand): { primary: string; accent: string } {
  const primary = hex(brand?.primary);
  const accent = hex(brand?.accent);
  return {
    primary: primary && 1.05 / (luminance(primary) + 0.05) >= 4.5 ? primary : NAVY,
    accent: accent ?? GOLD,
  };
}

type Columns = {
  time: boolean;
  length: boolean;
  leaders: boolean;
  description: boolean;
  notes: boolean;
};

function columnsFor(view: PlanView): Columns {
  const o = view.options;
  return {
    time: o.showTimes,
    length: o.showLengths,
    leaders: o.showLeaders,
    description: o.showDescriptions,
    notes: o.preset !== "order" && o.categories.length > 0,
  };
}

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN,
    paddingHorizontal: MARGIN,
    paddingBottom: MARGIN + FOOTER_HEIGHT + 6,
    fontFamily: FONT,
    fontWeight: 400,
    fontSize: 9,
    // No lineHeight on the page or a View: react-pdf then drops the
    // "Page x of y" text. Each Text style sets fontSize with its lineHeight,
    // since a unitless lineHeight without its own fontSize scales from 18pt.
    color: INK,
    backgroundColor: "#FFFFFF",
  },
  headerRow: { flexDirection: "row", alignItems: "center" },
  logo: { width: 42, height: 42, marginRight: 12, objectFit: "contain" },
  headerText: { flex: 1 },
  church: { lineHeight: LH, fontSize: 9, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontSize: 18, fontWeight: 700, lineHeight: 1.25, marginTop: 2 },
  subtitle: { fontSize: 10, fontWeight: 600, lineHeight: LH, color: INK, marginTop: 3 },
  meta: { lineHeight: LH, fontSize: 9, color: MUTED, marginTop: 2 },
  presetBox: {
    marginLeft: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: INK,
    borderRadius: 3,
    alignItems: "flex-end",
    maxWidth: 170,
  },
  presetLabel: { fontSize: 9, fontWeight: 700 },
  audience: { lineHeight: LH, fontSize: 8, color: MUTED, marginTop: 1, textAlign: "right" },
  rule: { height: 2.5, marginTop: 10, marginBottom: 12 },
  planNotes: { borderWidth: 1, borderColor: HAIRLINE, borderRadius: 3, padding: 8, marginBottom: 12 },
  planNotesTitle: { lineHeight: LH, fontSize: 9, fontWeight: 700, marginBottom: 3 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1.25,
    borderBottomColor: INK,
    paddingBottom: 4,
  },
  headCell: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: INK },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    paddingVertical: 5,
  },
  section: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: INK,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 9.5,
    fontWeight: 700,
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionSubtotal: { fontSize: 9.5, fontWeight: 700, color: "#FFFFFF" },
  cellTime: { fontSize: 9, lineHeight: LH, width: 54, paddingRight: 6 },
  cellLength: { fontSize: 9, lineHeight: LH, width: 42, paddingRight: 6, textAlign: "right" },
  cellItem: { flex: 3, paddingRight: 8 },
  cellLeaders: { fontSize: 9, lineHeight: LH, flex: 2, paddingRight: 8 },
  cellDescription: { fontSize: 9, lineHeight: LH, flex: 2.5, paddingRight: 8 },
  cellNotes: { flex: 3 },
  timeText: { fontWeight: 600 },
  itemTitle: { fontSize: 9, lineHeight: LH, fontWeight: 600 },
  songLine: { lineHeight: LH, fontSize: 8, color: MUTED, marginTop: 1 },
  noteLine: { fontSize: 9, lineHeight: LH, marginBottom: 2 },
  noteLabel: { fontWeight: 700 },
  empty: { lineHeight: LH, marginTop: 12, fontSize: 10, color: MUTED },
  footer: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    bottom: MARGIN,
    height: FOOTER_HEIGHT,
    borderTopWidth: 0.75,
    borderTopColor: RULE,
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: MUTED,
  },
  footerTotal: { fontWeight: 600, color: INK },
  footerGenerated: { textAlign: "right" },
  // A dynamic `render` text needs its own fixed box to get a width.
  footerPage: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    bottom: MARGIN + FOOTER_HEIGHT - 16,
    fontSize: 8,
    color: MUTED,
    textAlign: "center",
  },
});

function NoteList({ notes }: { notes: PlanViewNote[] }) {
  return (
    <>
      {notes.map((note, i) => (
        <Text key={`${note.category}-${i}`} style={styles.noteLine}>
          <Text style={styles.noteLabel}>{note.label}: </Text>
          {note.body}
        </Text>
      ))}
    </>
  );
}

function TableHead({ columns }: { columns: Columns }) {
  return (
    <View style={styles.tableHead}>
      {columns.time && <Text style={[styles.cellTime, styles.headCell]}>Time</Text>}
      <Text style={[styles.cellItem, styles.headCell]}>Item</Text>
      {columns.length && <Text style={[styles.cellLength, styles.headCell]}>Length</Text>}
      {columns.leaders && <Text style={[styles.cellLeaders, styles.headCell]}>Leaders</Text>}
      {columns.description && <Text style={[styles.cellDescription, styles.headCell]}>Description</Text>}
      {columns.notes && <Text style={[styles.cellNotes, styles.headCell]}>Notes</Text>}
    </View>
  );
}

function SectionRow({ row, primary }: { row: PlanViewRow; primary: string }) {
  return (
    // Keep a section heading with at least its first item.
    <View style={[styles.section, { backgroundColor: primary }]} wrap={false} minPresenceAhead={36}>
      <Text style={styles.sectionTitle}>{row.title}</Text>
      {row.subtotalSeconds !== null && (
        <Text style={styles.sectionSubtotal}>{formatDuration(row.subtotalSeconds)}</Text>
      )}
    </View>
  );
}

function ItemRow({ row, columns, timeZone }: { row: PlanViewRow; columns: Columns; timeZone: string }) {
  const textLength = (row.description?.length ?? 0) + row.notes.reduce((n, note) => n + note.body.length, 0);
  return (
    // Short rows stay on one page; a very long one may break rather than overflow.
    <View style={styles.row} wrap={textLength > 700}>
      {columns.time && (
        <Text style={[styles.cellTime, styles.timeText]}>
          {row.startsAt ? formatClockTime(row.startsAt, timeZone) : ""}
        </Text>
      )}
      <View style={styles.cellItem}>
        <Text style={styles.itemTitle}>{row.title}</Text>
        {row.songLine && <Text style={styles.songLine}>{row.songLine}</Text>}
      </View>
      {columns.length && (
        <Text style={styles.cellLength}>{row.lengthSeconds !== null ? formatDuration(row.lengthSeconds) : ""}</Text>
      )}
      {columns.leaders && <Text style={styles.cellLeaders}>{row.leaders.join(", ")}</Text>}
      {columns.description && <Text style={styles.cellDescription}>{row.description ?? ""}</Text>}
      {columns.notes && (
        <View style={styles.cellNotes}>
          <NoteList notes={row.notes} />
        </View>
      )}
    </View>
  );
}

function formatGenerated(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export function PlanPdfDocument({
  view,
  churchName,
  logoSrc,
  timeZone,
  generatedAt,
  brand,
  orientation = "portrait",
  audience,
}: PlanPdfDocumentProps) {
  const colors = planPdfColors(brand);
  const columns = columnsFor(view);
  const presetLabel = view.options.preset === "order" ? "Order of service" : SHARE_PRESET_LABELS[view.options.preset];
  const heading = view.title ? `${view.serviceTypeName}: ${view.title}` : view.serviceTypeName;
  const dateLine = [view.date ? formatPlanDate(view.date) : null, view.series].filter(Boolean).join(" · ");

  const serviceTimes = view.times.filter((t) => t.kind === "service");
  const listedTimes = serviceTimes.length ? serviceTimes : view.times;
  const timesLine = listedTimes
    .map((t) => `${t.label} ${formatClockTime(t.startsAt, timeZone)}`)
    .join(" · ");
  const selected = view.times.find((t) => t.id === view.selectedTimeId);
  const timesNote =
    view.options.showTimes && selected && listedTimes.length > 1
      ? `Times below are for ${selected.label} (${formatClockTime(selected.startsAt, timeZone)})`
      : null;

  const totalLine = [
    `Total ${formatDuration(view.totalSeconds)}`,
    view.targetSeconds ? `Target ${formatDuration(view.targetSeconds)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const generated = `Made ${formatGenerated(generatedAt, timeZone)}`;
  const hasItems = view.rows.some((row) => row.itemType !== "header");

  return (
    <Document title={`${heading}${view.date ? ` ${view.date}` : ""}`} author={churchName} creator="FaithForm">
      <Page size="LETTER" orientation={orientation} style={styles.page} wrap>
        <View style={styles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : null}
          <View style={styles.headerText}>
            <Text style={styles.church}>{churchName}</Text>
            <Text style={[styles.title, { color: colors.primary }]}>{heading}</Text>
            {dateLine ? <Text style={styles.subtitle}>{dateLine}</Text> : null}
            {timesLine ? <Text style={styles.meta}>{timesLine}</Text> : null}
            {timesNote ? <Text style={styles.meta}>{timesNote}</Text> : null}
          </View>
          <View style={styles.presetBox}>
            <Text style={styles.presetLabel}>{presetLabel}</Text>
            {audience ? <Text style={styles.audience}>{audience}</Text> : null}
          </View>
        </View>
        <View style={[styles.rule, { backgroundColor: colors.accent }]} />

        {view.planNotes.length > 0 && (
          <View style={styles.planNotes} wrap={false}>
            <Text style={styles.planNotesTitle}>Notes for the whole service</Text>
            <NoteList notes={view.planNotes} />
          </View>
        )}

        {hasItems ? (
          <View>
            <TableHead columns={columns} />
            {view.rows.map((row) =>
              row.itemType === "header" ? (
                <SectionRow key={row.id} row={row} primary={colors.primary} />
              ) : (
                <ItemRow key={row.id} row={row} columns={columns} timeZone={timeZone} />
              ),
            )}
          </View>
        ) : (
          <Text style={styles.empty}>
            {view.options.preset === "person"
              ? "Nothing in this plan is assigned to this person yet."
              : "This plan has no items yet."}
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerTotal}>{totalLine}</Text>
          <Text style={styles.footerGenerated}>{generated}</Text>
        </View>
        <Text
          style={styles.footerPage}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}
