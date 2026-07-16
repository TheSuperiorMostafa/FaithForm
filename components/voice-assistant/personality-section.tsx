"use client";

import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  SPEAKING_PACES,
  VOICE_LANGUAGES,
  VOICE_TONES,
  type SpeakingPace,
  type VoiceGender,
  type VoiceTone,
} from "@/types/voice-assistant";

const TONE_OPTIONS: { value: VoiceTone; label: string; description: string }[] = [
  {
    value: "warm_friendly",
    label: "Warm & Friendly",
    description: "Welcoming and conversational, like a greeter at the door.",
  },
  {
    value: "professional",
    label: "Professional",
    description: "Clear and courteous, like a front-desk coordinator.",
  },
  {
    value: "traditional_formal",
    label: "Traditional & Formal",
    description: "Respectful and measured, suited to formal worship settings.",
  },
];

const GENDER_OPTIONS: { value: VoiceGender; label: string; description: string }[] = [
  {
    value: "male",
    label: "Male",
    description: "A clear American male voice.",
  },
  {
    value: "female",
    label: "Female",
    description: "A warm American female voice.",
  },
];

const PACE_LABELS: Record<SpeakingPace, string> = {
  slow: "Slow",
  normal: "Normal",
  energetic: "Energetic",
};

function paceToIndex(pace: SpeakingPace): number {
  return SPEAKING_PACES.indexOf(pace);
}

function indexToPace(index: number): SpeakingPace {
  return SPEAKING_PACES[index] ?? "normal";
}

type PersonalitySectionProps = {
  tone: VoiceTone;
  speakingPace: SpeakingPace;
  voiceGender: VoiceGender;
  language: string;
  signoffMessage: string;
  readOnly?: boolean;
  onChange: (patch: {
    tone?: VoiceTone;
    speakingPace?: SpeakingPace;
    voiceGender?: VoiceGender;
    language?: string;
    signoffMessage?: string;
  }) => void;
};

export function PersonalitySection({
  tone,
  speakingPace,
  voiceGender,
  language,
  signoffMessage,
  readOnly = false,
  onChange,
}: PersonalitySectionProps) {
  const paceIndex = paceToIndex(speakingPace);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personality</CardTitle>
        <p className="text-sm text-muted-foreground">
          How your assistant sounds on the church phone.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={readOnly}>
          <legend className="col-span-full text-sm font-semibold">Tone</legend>
          {TONE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10",
                readOnly && "cursor-default opacity-80",
              )}
            >
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  name="voice-tone"
                  value={opt.value}
                  checked={tone === opt.value}
                  disabled={readOnly}
                  className="mt-0.5 size-4"
                  onChange={() => onChange({ tone: opt.value })}
                />
                <span className="font-semibold">{opt.label}</span>
              </span>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </label>
          ))}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={readOnly}>
          <legend className="col-span-full text-sm font-semibold">Voice</legend>
          {GENDER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10",
                readOnly && "cursor-default opacity-80",
              )}
            >
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  name="voice-gender"
                  value={opt.value}
                  checked={voiceGender === opt.value}
                  disabled={readOnly}
                  className="mt-0.5 size-4"
                  onChange={() => onChange({ voiceGender: opt.value })}
                />
                <span className="font-semibold">{opt.label}</span>
              </span>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="speaking-pace">Speaking Pace</Label>
          <input
            id="speaking-pace"
            type="range"
            min={0}
            max={2}
            step={1}
            value={paceIndex}
            disabled={readOnly}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-accent disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(e) =>
              onChange({ speakingPace: indexToPace(Number(e.target.value)) })
            }
          />
          <p className="text-sm font-medium text-foreground" aria-live="polite">
            {PACE_LABELS[speakingPace]}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="language">Language</Label>
          <Select
            id="language"
            value={language}
            disabled={readOnly}
            onChange={(e) => onChange({ language: e.target.value })}
          >
            {VOICE_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Phone greeting</Label>
          <p className="rounded-[10px] border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            First thing callers hear — set in{" "}
            <Link href="/dashboard/church-profile" className="font-medium text-accent underline">
              Church Profile → AI knowledge → Phone greeting
            </Link>
            . A recording notice is added automatically if missing.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="signoff-message">Sign-off Message</Label>
          <Textarea
            id="signoff-message"
            placeholder="Alright — take care. God bless."
            value={signoffMessage}
            disabled={readOnly}
            onChange={(e) => onChange({ signoffMessage: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Said naturally before the call ends.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
