import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type {
  Sermon,
  SermonContent,
  SermonOutline,
} from "@/types/sermon";
import type { ExportPassage } from "@/lib/sermon/passages";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 20, marginBottom: 8, fontWeight: "bold" },
  meta: { fontSize: 10, color: "#64748b", marginBottom: 20 },
  sectionTitle: { fontSize: 14, marginTop: 16, marginBottom: 6, fontWeight: "bold" },
  body: { lineHeight: 1.5, marginBottom: 8 },
  scriptureRef: { fontSize: 12, fontWeight: "bold", marginTop: 10, marginBottom: 4 },
  scriptureText: { lineHeight: 1.6, marginBottom: 6 },
  // Small and bold, the way a printed Bible sets them: readable enough to find
  // a verse mid-discussion, quiet enough not to break up the reading.
  verseNumber: { fontSize: 7.5, fontWeight: "bold", color: "#475569" },
  translation: { fontSize: 9, color: "#94a3b8", marginBottom: 8 },
  pointSummary: { lineHeight: 1.5, marginBottom: 4 },
  pointScripture: { fontSize: 10, color: "#64748b", marginBottom: 8 },
});

function PassageBlock({ passage }: { passage: ExportPassage }) {
  return (
    <View>
      <Text style={styles.scriptureRef}>{passage.ref}</Text>
      <Text style={styles.scriptureText}>
        {passage.verses.map((verse, i) => (
          <Text key={i}>
            {verse.number > 0 ? (
              <Text style={styles.verseNumber}>{`${verse.number} `}</Text>
            ) : null}
            {`${verse.plainText}${i < passage.verses.length - 1 ? " " : ""}`}
          </Text>
        ))}
      </Text>
      {passage.translation ? (
        <Text style={styles.translation}>{passage.translation}</Text>
      ) : null}
    </View>
  );
}

function SermonPdfDoc({
  sermon,
  passages,
}: {
  sermon: Sermon;
  passages: ExportPassage[];
}) {
  const content = sermon.content as SermonContent | null;
  const outline = sermon.outline as SermonOutline | null;
  const metaParts = [
    sermon.scripture_refs.join(" · "),
    sermon.sermon_date
      ? new Date(`${sermon.sermon_date}T12:00:00`).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null,
  ].filter(Boolean);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{sermon.title}</Text>
        {metaParts.length > 0 && (
          <Text style={styles.meta}>{metaParts.join(" · ")}</Text>
        )}
        {passages.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Scripture</Text>
            {passages.map((passage, i) => (
              <PassageBlock key={i} passage={passage} />
            ))}
          </>
        )}
        {content ? (
          <>
            <Text style={styles.sectionTitle}>Introduction</Text>
            <Text style={styles.body}>{content.intro}</Text>
            {content.points.map((p, i) => (
              <View key={i}>
                <Text style={styles.sectionTitle}>
                  {i + 1}. {p.title}
                </Text>
                <Text style={styles.body}>{p.body}</Text>
              </View>
            ))}
            <Text style={styles.sectionTitle}>Illustrations</Text>
            {content.illustrations.map((ill, i) => (
              <Text key={i} style={styles.body}>
                • {ill}
              </Text>
            ))}
            <Text style={styles.sectionTitle}>Application</Text>
            <Text style={styles.body}>{content.application}</Text>
            <Text style={styles.sectionTitle}>Closing Prayer</Text>
            <Text style={styles.body}>{content.prayer}</Text>
          </>
        ) : outline ? (
          <>
            <Text style={styles.sectionTitle}>Introduction</Text>
            <Text style={styles.body}>{outline.intro}</Text>
            {outline.points.map((p, i) => (
              <View key={i}>
                <Text style={styles.sectionTitle}>
                  {i + 1}. {p.title}
                </Text>
                <Text style={styles.pointSummary}>{p.summary}</Text>
                {p.scripture ? (
                  <Text style={styles.pointScripture}>{p.scripture}</Text>
                ) : null}
              </View>
            ))}
            <Text style={styles.sectionTitle}>Application</Text>
            <Text style={styles.body}>{outline.application}</Text>
            <Text style={styles.sectionTitle}>Closing</Text>
            <Text style={styles.body}>{outline.closing}</Text>
          </>
        ) : (
          <Text style={styles.body}>No lesson content yet.</Text>
        )}
      </Page>
    </Document>
  );
}

/**
 * The lesson as a handout.
 *
 * Deliberately not everything the builder holds: the discussion questions stay
 * on screen, where their warm-up / observation / interpretation / application
 * labels help whoever is leading. Printed, that scaffolding read as filler
 * between the lesson and the passage it was teaching.
 */
export async function renderSermonPdf(
  sermon: Sermon,
  passages: ExportPassage[] = [],
): Promise<Buffer> {
  const doc = <SermonPdfDoc sermon={sermon} passages={passages} />;
  const blob = await pdf(doc).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
