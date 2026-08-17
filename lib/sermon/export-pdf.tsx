import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type {
  DiscussionQuestion,
  Sermon,
  SermonContent,
  SermonOutline,
} from "@/types/sermon";
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
  pointSummary: { lineHeight: 1.5, marginBottom: 4 },
  pointScripture: { fontSize: 10, color: "#64748b", marginBottom: 8 },
  questionCategory: {
    fontSize: 9,
    color: "#94a3b8",
    textTransform: "uppercase",
    marginTop: 6,
  },
});

const QUESTION_CATEGORY_LABEL: Record<DiscussionQuestion["category"], string> = {
  warmup: "Warm-up",
  observation: "Observation",
  interpretation: "Interpretation",
  application: "Application",
};

function SermonPdfDoc({
  sermon,
  passages,
  questions,
}: {
  sermon: Sermon;
  passages: ScripturePassage[];
  questions: DiscussionQuestion[];
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

        {questions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Discussion Questions</Text>
            {questions.map((q, i) => (
              <View key={i}>
                <Text style={styles.questionCategory}>
                  {QUESTION_CATEGORY_LABEL[q.category] ?? q.category}
                </Text>
                <Text style={styles.body}>
                  {i + 1}. {q.question}
                </Text>
              </View>
            ))}
          </>
        )}
      </Page>
    </Document>
  );
}

export async function renderSermonPdf(
  sermon: Sermon,
  passages: ScripturePassage[] = [],
  questions: DiscussionQuestion[] = [],
): Promise<Buffer> {
  const doc = (
    <SermonPdfDoc sermon={sermon} passages={passages} questions={questions} />
  );
  const blob = await pdf(doc).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
