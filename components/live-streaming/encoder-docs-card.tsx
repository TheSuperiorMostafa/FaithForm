import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen } from "lucide-react";

const ENCODER_PRESETS = [
  { label: "Resolution", value: "1920×1080 (1080p)" },
  { label: "Frame rate", value: "30 fps" },
  { label: "Keyframe interval", value: "2 seconds" },
  { label: "Video bitrate", value: "6 Mbps CBR" },
  { label: "Audio", value: "AAC 128–160 kbps, 48 kHz" },
];

const ENCODERS = [
  {
    name: "OBS Studio",
    steps: [
      "Settings → Stream → Service: Custom",
      "Server: your FaithForm RTMP URL (shown above)",
      "Stream key: your church stream key",
      "Output → Video: 1920×1080, 30 fps; Output mode Advanced; Encoder x264 or NVENC; bitrate 6000 Kbps; keyframe 2 s",
    ],
  },
  {
    name: "ATEM / Blackmagic",
    steps: [
      "Streaming → Service: Custom",
      "Server and key from FaithForm encoder card",
      "Encoder: H.264, 1080p30, 6000 kbps, keyframe every 60 frames at 30 fps",
    ],
  },
  {
    name: "vMix",
    steps: [
      "Add Output → External → destination RTMP",
      "URL and stream name from FaithForm",
      "Streaming quality: 1080p, 30 fps, 6000 kbps",
    ],
  },
];

export function EncoderDocsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="size-4 text-accent" />
          Encoder setup
        </CardTitle>
        <CardDescription>
          Recommended settings for stable syndication and HLS playback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended preset
          </p>
          <dl className="grid gap-1 text-sm sm:grid-cols-2">
            {ENCODER_PRESETS.map((item) => (
              <div key={item.label} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {ENCODERS.map((encoder) => (
          <div key={encoder.name} className="space-y-2">
            <p className="text-sm font-semibold">{encoder.name}</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {encoder.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          SRT ingest is available on the relay when enabled — use the same stream
          path with an SRT URL from your dashboard host.
        </p>
      </CardContent>
    </Card>
  );
}
