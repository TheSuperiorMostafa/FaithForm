/**
 * The portable encoding policy: what Faithful will promise both platforms can
 * play, and why each bound is where it is.
 *
 * This file is the policy. `rendition.ts` is the parser that enforces it. They
 * are separate so the policy can be read, argued with, and cited in the
 * dashboard without reading a box walker.
 *
 * ## What "portable" is being claimed
 *
 * **Not** "this will decode on the device in your hand." Nothing a server can
 * read from a file proves that: a decoder can be busy, a device can be thermally
 * throttled, and a hardware decoder can have bugs no bitstream reveals. What is
 * claimed is narrower and checkable — *this rendition conforms to an encoding
 * profile that both supported platforms document support for*. Real playback
 * stays a device-validation item in
 * `P9_DEVICE_AND_PROVIDER_TEST_RUNBOOK.md`.
 *
 * ## The supported targets
 *
 * Read from the projects, not assumed:
 *
 *   * **iOS 17+** — `apps/faithful-ios/Package.swift` declares `.iOS(.v17)`.
 *   * **Android API 26+ (8.0)** — `apps/faithful-android/app/build.gradle.kts`
 *     declares `minSdk = 26`.
 *
 * Android is the binding constraint on every bound below. iOS 17 runs only on
 * hardware that decodes H.264 High Profile to Level 5.2 and HEVC besides;
 * Android API 26 spans a decade of hardware whose guarantees come from the
 * Compatibility Definition Document rather than from a single vendor.
 */

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * H.264 profiles accepted, by `profile_idc` as it appears in `avcC`.
 *
 * | | `profile_idc` | Why |
 * | --- | --- | --- |
 * | Baseline | 66 | Android CDD §5.3.4 requires a Baseline decoder on **every** device. iOS has always decoded it. |
 * | Main | 77 | CDD requires Main on every device that supports 720p or 1080p playback, which is every device this app runs on. `ws-ingest.py` encodes `-profile:v main`, so the browser publisher lands here. |
 * | High | 100 | **Not CDD-mandated.** Accepted anyway, deliberately — see below. |
 *
 * ### High Profile is the one bound that runs ahead of the written guarantee
 *
 * Every hardware decoder shipped in an API 26+ device implements High, and it is
 * what OBS, ffmpeg's `libx264` defaults, and essentially every RTMP encoder
 * produce. Refusing it would refuse most real church recordings in order to
 * honour a document that no shipping device actually falls short of.
 *
 * That is a judgement, and it is the weakest link in this policy. It is written
 * down rather than hidden so that a real device failure has somewhere obvious to
 * point.
 *
 * ### What is refused, and why it is not pedantry
 *
 * High 10 (110), High 4:2:2 (122) and High 4:4:4 Predictive (244) are refused
 * along with every intra-only and CAVLC-only variant. These are not exotic
 * distinctions: a 10-bit or 4:2:2 stream is exactly what a broadcast-grade
 * capture card produces by default, both platforms' *software* decoders may
 * handle it while the hardware path does not, and the failure lands on a
 * congregation rather than on a test bench.
 */
export const PORTABLE_H264_PROFILES = new Set([66, 77, 100]);

/**
 * The highest `level_idc` accepted — 4.2, encoded as 42.
 *
 * The guarantee is tiered, and the tiers are worth stating separately because
 * only the first two are written down anywhere normative:
 *
 *   * **≤ 3.0** — CDD-mandated on every Android device, at Baseline.
 *   * **≤ 4.0** — CDD-mandated on every device that plays 720p or 1080p, at Main.
 *   * **4.1 – 4.2** — *not* mandated. Universally implemented in API 26+
 *     hardware decoders, and required for 1080p at 50 and 60 fps, which a church
 *     streaming a service at 1080p60 will produce.
 *
 * Above 4.2 is 4K territory, where Android decoder support genuinely varies by
 * device and no server-side claim can be honest. A recording that lands there
 * stays unpublished, and the church lowers its encoder's resolution.
 *
 * Level `1b` — the low-complexity variant signalled as level 11 with
 * `constraint_set3` — is below every bound here and is accepted on its face.
 */
export const MAX_H264_LEVEL = 42;

/** 4:2:0 only. `chroma_format_idc` as carried in `avcC`'s High-profile tail. */
export const PORTABLE_H264_CHROMA = 1;

/** 8-bit only. `bit_depth_luma_minus8` and `bit_depth_chroma_minus8` must be 0. */
export const PORTABLE_H264_BIT_DEPTH = 8;

/**
 * `AVCDecoderConfigurationRecord.lengthSizeMinusOne` values that are legal.
 *
 * 0, 1 and 3 mean 1-, 2- and 4-byte NAL length prefixes. **2 is not a value the
 * specification defines**, and a file carrying it is malformed rather than
 * merely unusual — worth rejecting explicitly, because a parser that shrugs at
 * it is a parser that will shrug at the next impossible field too.
 */
export const LEGAL_NAL_LENGTH_SIZES = new Set([0, 1, 3]);

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/**
 * The only `objectTypeIndication` accepted in a `DecoderConfigDescriptor`.
 *
 * `0x40` is MPEG-4 Audio. An `mp4a` sample entry can legally carry MP3
 * (`0x69`, `0x6b`) or MPEG-2 AAC (`0x66`–`0x68`) instead, which is precisely the
 * case a fourcc check misses: the box says `mp4a` and the payload is not what
 * either platform is being promised.
 */
export const MPEG4_AUDIO_OBJECT_TYPE_INDICATION = 0x40;

/**
 * AAC audio object types accepted.
 *
 * | AOT | | Why |
 * | --- | --- | --- |
 * | 2 | AAC-LC | CDD-mandated decoder on every Android device; iOS has always decoded it. What `ffmpeg -c:a aac` produces. |
 * | 5 | HE-AAC (SBR) | CDD-mandated. |
 * | 29 | HE-AAC v2 (PS) | CDD-mandated. |
 *
 * Everything else is refused, including AAC-LTP (4), AAC Scalable (6), ER
 * variants, AAC-ELD (39) and xHE-AAC/USAC (42). xHE-AAC is the interesting one:
 * iOS 13+ and Android 9+ both decode it, but Android 8.0 — this app's floor —
 * does not, so promising it would be promising something a supported device
 * cannot do.
 */
export const PORTABLE_AAC_OBJECT_TYPES = new Set([2, 5, 29]);

/**
 * Sampling frequencies accepted, in Hz.
 *
 * Android's CDD states AAC-LC support across **8 to 48 kHz**. Above that —
 * 64, 88.2 and 96 kHz — is outside the guarantee, is pointless for a spoken
 * service, and is what a misconfigured audio interface produces.
 */
export const MIN_AUDIO_SAMPLE_RATE = 8_000;
export const MAX_AUDIO_SAMPLE_RATE = 48_000;

/**
 * Channel configurations accepted: mono and stereo.
 *
 * Multichannel AAC decoding on Android is per-device rather than mandated, and a
 * 5.1 recording that downmixes on one phone and drops to silence on another is
 * the exact failure this gate exists to prevent. Channel configuration `0` —
 * "defined in the program config element" — is also refused, because it means
 * the channel count is not provable from the configuration at all.
 */
export const PORTABLE_AUDIO_CHANNELS = new Set([1, 2]);

/** `samplingFrequencyIndex` → Hz. Indices 13 and 14 are reserved; 15 is escape. */
export const AAC_SAMPLE_RATES: readonly (number | null)[] = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050,
  16_000, 12_000, 11_025, 8_000, 7_350, null, null, null,
];

// ---------------------------------------------------------------------------
// Naming what was found
// ---------------------------------------------------------------------------

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * The RFC 6381 codec string for an H.264 track — `avc1.4d401f` and friends.
 *
 * Stored rather than a prose label because it is the form both platforms' own
 * documentation, `MediaCodec`, and every bug report use. A support conversation
 * that starts with `avc1.640034` is shorter than one that starts with "High".
 */
export function h264CodecString(
  sampleEntry: string,
  profile: number,
  constraints: number,
  level: number,
): string {
  return `${sampleEntry}.${hex2(profile)}${hex2(constraints)}${hex2(level)}`;
}

/** The RFC 6381 codec string for an MPEG-4 audio track — `mp4a.40.2`. */
export function aacCodecString(objectTypeIndication: number, audioObjectType: number): string {
  return `mp4a.${objectTypeIndication.toString(16)}.${audioObjectType}`;
}
