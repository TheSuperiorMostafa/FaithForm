"use client";

import { Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SpeakingPace, VoiceTone } from "@/types/voice-assistant";

const TONE_LABELS: Record<VoiceTone, string> = {
  warm_friendly: "Warm & Friendly",
  professional: "Professional",
  traditional_formal: "Traditional & Formal",
};

const PACE_HINTS: Record<SpeakingPace, string> = {
  slow: "speaks calmly and unhurried",
  normal: "speaks at a natural pace",
  energetic: "speaks with upbeat energy",
};

function getSimulatedExchange(tone: VoiceTone, assistantName: string) {
  const name = assistantName.trim() || "your assistant";

  const callerQuestion = "What time is your Sunday service?";

  const responses: Record<VoiceTone, string> = {
    warm_friendly: `Great question! Let me check that for you. Our next worship service is this Sunday — I'd love to welcome you in person!`,
    professional: `Certainly. I'll look up our service schedule for you. One moment, please.`,
    traditional_formal: `Thank you for your inquiry. Allow me a moment to retrieve our service schedule for you.`,
  };

  const followUp: Record<VoiceTone, string> = {
    warm_friendly: `Is there anything else I can help you with today?`,
    professional: `Is there anything else I can assist you with?`,
    traditional_formal: `May I be of further assistance to you today?`,
  };

  return {
    greeting: `Hi, you've reached the church. This is ${name}.`,
    callerQuestion,
    assistantResponse: responses[tone],
    followUp: followUp[tone],
  };
}

type PhonePreviewProps = {
  assistantName: string;
  greetingMessage: string;
  tone: VoiceTone;
  speakingPace: SpeakingPace;
};

export function PhonePreview({
  assistantName,
  greetingMessage,
  tone,
  speakingPace,
}: PhonePreviewProps) {
  const displayName = assistantName.trim() || "your assistant";
  const greeting =
    greetingMessage.trim() ||
    `Thank you for calling. This is ${displayName}, how can I help you today?`;
  const exchange = getSimulatedExchange(tone, assistantName);

  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="size-4 text-accent" aria-hidden />
          Live preview
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="mx-auto w-full max-w-[280px] rounded-[2rem] border-[3px] border-border bg-muted/30 p-3 shadow-sm">
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <div className="mb-4 flex justify-center">
              <div className="size-2 rounded-full bg-muted-foreground/30" />
            </div>

            <div className="space-y-3 text-sm">
              <PreviewLine
                label="Assistant"
                text={`Your assistant will answer as: ${displayName}`}
              />
              <PreviewLine label="Greeting" text={greeting} />
              <PreviewLine label="Tone" text={TONE_LABELS[tone]} />
              <p className="text-xs text-muted-foreground">
                {displayName} {PACE_HINTS[speakingPace]}.
              </p>

              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sample call
                </p>
                <div className="space-y-2">
                  <Bubble align="left" text={exchange.greeting} />
                  <Bubble align="right" text={exchange.callerQuestion} muted />
                  <Bubble align="left" text={exchange.assistantResponse} />
                  <Bubble align="right" text="That's all, thank you!" muted />
                  <Bubble align="left" text={exchange.followUp} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewLine({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 leading-snug">{text}</p>
    </div>
  );
}

function Bubble({
  align,
  text,
  muted = false,
}: {
  align: "left" | "right";
  text: string;
  muted?: boolean;
}) {
  return (
    <div className={align === "right" ? "flex justify-end" : "flex justify-start"}>
      <p
        className={
          muted
            ? "max-w-[90%] rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-xs leading-snug"
            : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-xs leading-snug"
        }
      >
        {text}
      </p>
    </div>
  );
}
