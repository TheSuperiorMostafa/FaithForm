/**
 * What to do in each streaming tool, in the fewest words that work, plus the
 * recommended settings for the few people who want to tune them.
 */

export type StreamingToolId = "obs" | "atem" | "vmix" | "other" | "browser" | "someone_else";

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
      "Press OK to save. When you're ready, press Start Streaming in OBS. Press Stop Streaming to finish.",
    ],
  },
  {
    id: "atem",
    name: "ATEM Mini Pro / Extreme",
    blurb: "Blackmagic switcher that streams on its own",
    usesKey: true,
    steps: [
      "Download the settings file below. In ATEM Software Control, choose Stream → Load Streaming Settings and open the file.",
      "Open Output → Live Stream. Select FaithForm as the Platform and Server, choose Church Service as Quality, and paste your stream key into Key.",
      "Press On Air on the ATEM to start. Press Off to finish.",
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
      "Press Save. When you're ready, use the Stream button in vMix to start and stop.",
    ],
  },
  {
    id: "other",
    name: "Other streaming equipment",
    blurb: "A camera or encoder that can stream to a custom server",
    usesKey: true,
    steps: [
      "Open your equipment's streaming settings and choose a custom server.",
      "Press Copy both below. Paste the Server address and Stream key into the matching fields and save.",
      "Use your equipment's streaming controls to start and stop the service.",
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
      "When they start streaming, the video check below will show that FaithForm is receiving it.",
    ],
  },
];

/** The service file contains the public server address. The private key is entered separately. */
export function atemSettingsDownloadUrl(serverUrl: string): string {
  const server = serverUrl.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const profiles = [
    { fps: 30, bitrate: 6000000 },
    { fps: 60, bitrate: 9000000 },
  ].map(({ fps, bitrate }) => `        <config resolution="1080p" fps="${fps}" codec="H264">
          <bitrate>${bitrate}</bitrate>
          <audio-bitrate>128000</audio-bitrate>
          <keyframe-interval>2</keyframe-interval>
        </config>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<streaming>
  <service>
    <name>FaithForm</name>
    <servers>
      <server>
        <name>FaithForm</name>
        <url>${server}</url>
      </server>
    </servers>
    <profiles>
      <profile>
        <name>Church Service</name>
${profiles}
      </profile>
    </profiles>
  </service>
</streaming>
`;
  return `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

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
    name: "ATEM Mini Pro / Extreme",
    steps: [
      "Import the FaithForm settings file from the ATEM setup steps above.",
      "Use the Church Service quality profile for H.264, 1080p30 at 6 Mbps or 1080p60 at 9 Mbps.",
      "For an original ATEM Mini without built-in streaming, connect by USB and use OBS or vMix.",
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
