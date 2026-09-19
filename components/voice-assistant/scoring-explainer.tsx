import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CALL_CLASSIFICATIONS,
  CLASSIFICATION_DESCRIPTIONS,
  CLASSIFICATION_LABELS,
  type CallClassification,
} from "@/lib/integrations/phone-call-scoring-prompt";
import { LEGACY_SCORE_NOTE, type CallScoreView } from "@/lib/utils/call-score";

const CLASSIFICATION_VARIANT: Record<
  CallClassification,
  "muted" | "secondary" | "info" | "warning"
> = {
  spam: "muted",
  no_engagement: "muted",
  vendor: "warning",
  real: "info",
};

export function ClassificationBadge({
  classification,
}: {
  classification: CallClassification | null;
}) {
  if (!classification) return null;
  return (
    <Badge variant={CLASSIFICATION_VARIANT[classification]}>
      {CLASSIFICATION_LABELS[classification]}
    </Badge>
  );
}

/**
 * A call the retired rubric scored has no kind, because that rubric never
 * asked. An empty Type cell reads as a bug; this says what it actually is.
 */
export function LegacyScoreBadge() {
  return (
    <Badge variant="muted" title={LEGACY_SCORE_NOTE}>
      Not yet sorted
    </Badge>
  );
}

/**
 * Red, and only for a caller in crisis. The amber badge that used to share
 * this spot marked every call the rubric thought someone should answer, and a
 * pilot church asked for it to go. A crisis is a different signal, so it keeps
 * its badge.
 */
export function UrgentBadge({ view }: { view: CallScoreView }) {
  if (!view.urgent) return null;
  return <Badge variant="destructive">Urgent</Badge>;
}

/**
 * The score is a judgement, and a judgement nobody can interrogate is one
 * nobody trusts. This says, in full, what the number means: including the part
 * that surprises people: a robocall the assistant refused scores a 10.
 */
export function ScoringExplainer() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How scoring works</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          Every call is first sorted into one of four kinds, then scored 1–10
          against what a good outcome means for <em>that</em> kind. A scam the
          assistant recognises and shuts down is a win for the church, so it
          scores near 10, not near 1.
        </p>

        <dl className="grid gap-3">
          {CALL_CLASSIFICATIONS.map((key) => (
            <div key={key} className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
              <dt>
                <ClassificationBadge classification={key} />
              </dt>
              <dd className="text-muted-foreground">
                {CLASSIFICATION_DESCRIPTIONS[key]}
              </dd>
            </div>
          ))}
        </dl>

        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="font-medium">The 1–10 bands, for real and vendor calls</p>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">10</span>: fully
              resolved, warm, accurate, nothing left hanging
            </li>
            <li>
              <span className="font-medium text-foreground">8–9</span>,
              resolved, with minor friction or a small missed opportunity
            </li>
            <li>
              <span className="font-medium text-foreground">6–7</span>: correct
              information given, but the caller&rsquo;s actual need was not met
            </li>
            <li>
              <span className="font-medium text-foreground">4–5</span>,
              deflected or took a message when it could have helped
            </li>
            <li>
              <span className="font-medium text-foreground">2–3</span>: wrong
              information, self-contradiction, or a legitimate request blocked
            </li>
            <li>
              <span className="font-medium text-foreground">1</span>: claimed to
              be human, promised something it cannot do, or invented a fact
            </li>
          </ul>
        </div>

        <div className="space-y-2 border-t border-border pt-3 text-muted-foreground">
          <p>
            Calls marked <strong className="text-foreground">Urgent</strong>{" "}
            are ones where the caller sounded like they were in crisis: in
            distress, grieving a death, worried about someone&rsquo;s safety, or
            needing help right away. Those are worth reading first.
          </p>
          <p>
            Summaries call your phone assistant &ldquo;the assistant&rdquo;
            unless it said its name on the call, and they only name a caller
            who gave their own name.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Calls scored before this rubric shipped are marked{" "}
          <strong className="font-medium text-foreground">Not yet sorted</strong>{" "}
          and shown uncoloured. Their number is the old ranking converted to
          1–10, not a judgement this rubric made. Use{" "}
          <strong className="font-medium text-foreground">Re-score older calls</strong>{" "}
          above to judge them properly; it sorts each one by kind and replaces
          the old reasoning. The same button also refreshes calls scored
          before the latest update to these rules.
        </p>
      </CardContent>
    </Card>
  );
}
