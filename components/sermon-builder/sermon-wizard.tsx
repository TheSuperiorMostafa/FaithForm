"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingOverlay } from "@/components/sermon-builder/loading-overlay";
import { ScriptureBlock } from "@/components/sermon-builder/scripture-block";
import {
  ScripturePicker,
  type ScripturePickerHandle,
} from "@/components/sermon-builder/scripture-picker";

type WizardProps = {
  seriesId?: string;
  initialTopic?: string;
  initialScripture?: string;
};

export function SermonWizard({
  seriesId,
  initialTopic = "",
  initialScripture = "",
}: WizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [topic, setTopic] = useState(initialTopic);
  const [scriptureRefs, setScriptureRefs] = useState<string[]>(() =>
    initialScripture
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
  );
  const [previewRef, setPreviewRef] = useState(
    initialScripture.split(",")[0]?.trim() ?? "",
  );
  const [audience, setAudience] = useState("General congregation");
  const [durationMin, setDurationMin] = useState(30);
  const [styleNotes, setStyleNotes] = useState("");
  const pickerRef = useRef<ScripturePickerHandle>(null);

  function goToStep2() {
    const pending = pickerRef.current?.commitPending();
    if (!topic.trim() && scriptureRefs.length === 0 && !pending) return;
    setStep(2);
  }

  async function generateOutline() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sermon/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          scripture_refs: scriptureRefs,
          audience,
          duration_min: durationMin,
          style_notes: styleNotes || undefined,
          series_id: seriesId,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");

      if (!res.ok) {
        if (res.status === 504) {
          throw new Error(
            "The AI took too long to respond. Please try again — outlines usually complete in 20–40 seconds.",
          );
        }
        if (isJson) {
          const data = await res.json().catch(() => null);
          throw new Error(
            data?.error ?? `Request failed (${res.status})`,
          );
        }
        throw new Error(`Request failed (${res.status})`);
      }

      if (!isJson) {
        throw new Error(
          "Unexpected response from the server. Please try again.",
        );
      }

      const data = await res.json();
      if (!data?.sermon?.id) {
        throw new Error("The outline was generated but no sermon ID was returned.");
      }

      router.push(`/dashboard/sermon-builder/${data.sermon.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex gap-2 text-sm text-muted-foreground">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={
              step === n
                ? "rounded-full bg-accent px-3 py-1 font-semibold text-accent-foreground"
                : "px-3 py-1"
            }
          >
            Step {n}
          </span>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Topic & Scripture</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="topic">Sermon topic</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Finding peace in anxious times"
              />
            </div>
            <div className="space-y-2">
              <Label>Scripture references</Label>
              <ScripturePicker
                ref={pickerRef}
                value={scriptureRefs}
                onChange={(refs) => {
                  setScriptureRefs(refs);
                  if (refs.length === 0) {
                    setPreviewRef("");
                  } else if (!refs.includes(previewRef)) {
                    setPreviewRef(refs[refs.length - 1]);
                  }
                }}
                onPreviewChange={setPreviewRef}
              />
            </div>
            {previewRef && scriptureRefs.includes(previewRef) && (
              <div className="space-y-2">
                <Label>Scripture preview — {previewRef}</Label>
                <ScriptureBlock passage={previewRef} />
              </div>
            )}
            {!topic.trim() && scriptureRefs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Enter a sermon topic or add at least one scripture reference to
                continue.
              </p>
            )}
            <Button onClick={goToStep2}>Next</Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Audience & length</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="audience">Audience</Label>
              <Input
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Target duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min={15}
                max={90}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card className="relative overflow-hidden">
          {loading && (
            <LoadingOverlay message="Generating your sermon outline…" />
          )}
          <CardHeader>
            <CardTitle>Style & tone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes for the AI (optional)</Label>
              <Textarea
                id="notes"
                value={styleNotes}
                onChange={(e) => setStyleNotes(e.target.value)}
                placeholder="Expository, warm, include one personal illustration prompt..."
                rows={4}
                disabled={loading}
              />
            </div>
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                disabled={loading}
              >
                Back
              </Button>
              <Button onClick={generateOutline} disabled={loading}>
                {loading ? "Generating…" : "Generate outline"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
