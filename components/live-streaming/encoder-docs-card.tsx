/**
 * What to do in each streaming tool, in the fewest words that work, plus the
 * recommended settings for the few people who want to tune them.
 */

export type StreamingToolId = "obs" | "atem" | "vmix" | "browser" | "someone_else";

/** Where the Setup choice is remembered, so Go live can act on "This computer". */
export const STREAMING_TOOL_KEY = "ff-streaming-tool";

export type StreamingTool = {
  id: StreamingToolId;
  name: string;
  /** One line under the name on the choice card. */
  blurb: string;
  /** The short steps shown once this tool is chosen. */
  steps: string[];
  /** Whether this tool needs the server and stream key pasted into it. */
  usesKey: boolean;
};

export const STREAMING_TOOLS: StreamingTool[] = [
  {
    id: "obs",
    name: "OBS Studio",
    blurb: "Free streaming software on a computer",
    usesKey: true,
    steps: [
      "In OBS, open Settings, then Stream. Set Service to Custom.",
      "Press Copy both below. Paste the Server into the Server box and the Stream key into the Stream Key box. The key stays the same until you replace it.",
      "Press OK, then Start Streaming.",
    ],
  },
  {
    id: "atem",
    name: "ATEM Mini",
    blurb: "Blackmagic video switcher",
    usesKey: true,
    steps: [
      "In ATEM Software Control, open the Output tab and choose Live Stream.",
      "Press Copy both below. Paste the Server and the Stream key into their boxes.",
      "Press On Air on the ATEM.",
    ],
  },
  {
    id: "vmix",
    name: "vMix",
    blurb: "Live production software",
    usesKey: true,
    steps: [
      "Press the gear next to Stream. For Destination, choose the custom server option.",
      "Press Copy both below. Paste the Server into URL and the Stream key into Stream Name or Key.",
      "Press Save, then Stream.",
    ],
  },
  {
    id: "browser",
    name: "This computer (camera)",
    blurb: "Use this computer's camera or screen",
    usesKey: false,
    steps: [
      "Open the Go live tab (the button below takes you there).",
      "Press Go live. FaithForm turns on this computer's camera first; allow it when your browser asks.",
      "Keep the tab open while you stream. Switch to your screen any time under “Stream from this computer”.",
    ],
  },
  {
    id: "someone_else",
    name: "Someone else sets it up",
    blurb: "A volunteer or a company does it for you",
    usesKey: true,
    steps: [
      "Press Copy both below and send it to the person who sets up your streaming.",
      "They paste the Server and the Stream key into their streaming software.",
      "Once they start streaming, Step 2 turns to Connected.",
    ],
  },
];

const ENCODER_PRESETS = [
  // Recordings are published to phones exactly as they were streamed, so the
  // format is the one setting that matters most.
  { label: "Video format", value: "H.264" },
  { label: "Resolution", value: "1920×1080 (1080p)" },
  { label: "Frame rate", value: "30 fps" },
  { label: "Keyframe interval", value: "2 seconds" },
  { label: "Video bitrate", value: "6 Mbps CBR" },
  { label: "Audio", value: "AAC 128–160 kbps, 48 kHz" },
];

const TOOL_DETAILS = [
  {
    name: "OBS Studio",
    steps: [
      "Settings → Stream → Service: Custom",
      "Server and Stream key: press Show stream key in Technical details and paste the whole value; it stays the same until you replace it",
      "Output → Video: 1920×1080, 30 fps; Output mode Advanced; Encoder x264 or NVENC; bitrate 6000 Kbps; keyframe 2 s",
    ],
  },
  {
    name: "ATEM / Blackmagic",
    steps: [
      "Streaming → Service: Custom",
      "Server and your church stream key from Technical details",
      "Encoder: H.264, 1080p30, 6000 kbps, keyframe every 60 frames at 30 fps",
    ],
  },
  {
    name: "vMix",
    steps: [
      "Add Output → External → custom RTMP destination",
      "Server and your church stream key from Technical details",
      "Streaming quality: 1080p, 30 fps, 6000 kbps",
    ],
  },
];

/**
 * Recommended settings, for the Advanced section of Setup. Technical terms
 * are allowed here: only the people who open "Advanced" see them.
 */
export function EncoderDocsCard() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-lg font-semibold">Recommended encoder settings</h3>
        <p className="text-[15px] text-muted-foreground">
          So your service streams smoothly and records in a format every phone can play.
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-border p-4 text-[15px] sm:grid-cols-2">
        {ENCODER_PRESETS.map((item) => (
          <div key={item.label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
      {TOOL_DETAILS.map((encoder) => (
        <div key={encoder.name} className="flex flex-col gap-2">
          <p className="text-[15px] font-semibold">{encoder.name}</p>
          <ol className="list-decimal space-y-1 pl-5 text-[15px] text-muted-foreground">
            {encoder.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ))}
      <p className="text-[15px] text-muted-foreground">
        Want to use SRT instead of RTMP? Contact FaithForm support and we&apos;ll help you set it up.
      </p>
    </div>
  );
}
