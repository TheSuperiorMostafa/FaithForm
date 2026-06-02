import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type { Sermon, SermonContent } from "@/types/sermon";
import type { ScripturePassage } from "@/lib/sermon/export-pptx";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 20, marginBottom: 8, fontWeight: "bold" },
  meta: { fontSize: 10, color: "#64748b", marginBottom: 20 },
  sectionTitle: { fontSize: 14, marginTop: 16, marginBottom: 6, fontWeight: "bold" },
  body: { lineHeight: 1.5, marginBottom: 8 },
  scriptureRef: { fontSize: 12, fontWeight: "bold", marginTop: 10, marginBottom: 4 },
  scriptureText: { lineHeight: 1.5, marginBottom: 6 },
  translation: { fontSize: 9, color: "#94a3b8", marginBottom: 8 },
});

function SermonPdfDoc({
  sermon,
  passages,
}: {
  sermon: Sermon;
  passages: ScripturePassage[];
}) {
  const content = sermon.content as SermonContent | null;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{sermon.title}</Text>
        <Text style={styles.meta}>
          {sermon.scripture_refs.join(" · ")} · {sermon.audience} ·{" "}
          {sermon.duration_min} min
        </Text>
        {passages.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Scripture</Text>
            {passages.map((p, i) => (
              <View key={i}>
                <Text style={styles.scriptureRef}>{p.ref}</Text>
                <Text style={styles.scriptureText}>{p.text}</Text>
                {p.translation ? (
                  <Text style={styles.translation}>{p.translation}</Text>
                ) : null}
              </View>
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
        ) : (
          <Text style={styles.body}>No draft content yet.</Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderSermonPdf(
  sermon: Sermon,
  passages: ScripturePassage[] = [],
): Promise<Buffer> {
  const doc = <SermonPdfDoc sermon={sermon} passages={passages} />;
  const blob = await pdf(doc).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
