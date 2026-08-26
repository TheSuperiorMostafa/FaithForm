import {
  AAC_SAMPLE_RATES,
  LEGAL_NAL_LENGTH_SIZES,
  MAX_AUDIO_SAMPLE_RATE,
  MAX_H264_LEVEL,
  MIN_AUDIO_SAMPLE_RATE,
  MPEG4_AUDIO_OBJECT_TYPE_INDICATION,
  PORTABLE_AAC_OBJECT_TYPES,
  PORTABLE_AUDIO_CHANNELS,
  PORTABLE_H264_BIT_DEPTH,
  PORTABLE_H264_CHROMA,
  PORTABLE_H264_PROFILES,
  aacCodecString,
  h264CodecString,
} from "@/lib/media/v1/portable-profile";

/**
 * Proving what a recording actually is.
 *
 * ## Why a parser and not a content-type
 *
 * A recording arrives as one object in a private bucket. Three things describe
 * it, and **none of them is trustworthy**:
 *
 *   * the **filename extension** — chosen by whoever named the file on the
 *     relay box, and `sanitizeRecordingFilename` already permits `.mkv`, which
 *     `AVPlayer` cannot decode;
 *   * the **upload content-type** — `video/mp4`, hard-coded in a shell script
 *     (`infra/stream-relay/upload-recording.sh`), sent regardless of what the
 *     file contains;
 *   * anything the **relay reports** — the relay is a client from this
 *     application's point of view, and a claim from a client about its own
 *     payload is not evidence.
 *
 * The one authoritative artifact is the object itself, which this server holds.
 *
 * ## Why a fourcc is not enough either
 *
 * The first version of this gate proved the container brand and the sample-entry
 * fourccs. That is a real improvement over a filename and still not sufficient:
 * `avc1` is the same four bytes whether the stream is Baseline 3.0 that every
 * phone decodes or High 4:4:4 Predictive 10-bit at Level 6.2 that neither
 * platform's hardware path will touch. `mp4a` is the same four bytes whether the
 * payload is AAC-LC or MP3-in-MP4.
 *
 * So the fourcc selects *which* configuration record to read, and the
 * configuration record — `avcC` for video, `esds` for audio — is what decides.
 * The policy those records are checked against is in `portable-profile.ts`.
 *
 * ## What is being claimed
 *
 * That the rendition conforms to an encoding profile both supported platforms
 * document support for. **Not** that a particular device will decode it: no
 * byte inspection can prove that, and this file does not pretend to. Real
 * playback remains a device and provider validation item.
 *
 * ## What this is not
 *
 * It is **not a transcoder**, and it does not become one. It reads a bounded
 * prefix and, when necessary, a bounded suffix of a file and reports what is
 * there. When what is there cannot be played on both platforms, the recording
 * stays unpublished and the dashboard says why. Producing a supported rendition
 * is the relay pipeline's job — see `P9_MEDIA_ELIGIBILITY.md`.
 *
 * ## Hostile input
 *
 * Everything below treats its input as attacker-controlled, because it is: the
 * relay uploads whatever is on its disk, and a compromised relay box or a
 * mis-aimed `upload-recording.sh` can put an arbitrary file at a storage path.
 * Every walk is bounded in depth, in box count and in bytes; every length is
 * range-checked before it is used; and an impossible structure produces a
 * refusal rather than an exception, a hang, or an allocation.
 */

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * How a recording would be delivered to a phone.
 *
 * `hls` is listed first because it is the form this architecture would prefer:
 * the live path already proxies protected HLS, and a VOD playlist would inherit
 * segment-level revocation and adaptive bitrate for free.
 *
 * **Nothing in this repository produces one.** The relay writes a single MP4 per
 * service and there is no VOD packager, so every recording today is
 * `progressive`. The value exists so the gate does not have to be rewritten if
 * that changes, and its absence is stated rather than implied.
 */
export type RenditionKind = "hls" | "progressive";

export type RenditionReason =
  /** Proven to conform to the portable profile. */
  | "ok"
  /** Matroska. `AVPlayer` cannot decode it; there is no iOS fallback. */
  | "container_matroska"
  /** Not an ISO base media file and not Matroska — nothing recognisable. */
  | "container_unrecognised"
  /** ISO base media, but a brand neither platform is guaranteed to accept. */
  | "container_brand_unsupported"
  /** A video sample entry this app will not promise both platforms can decode. */
  | "video_codec_unsupported"
  /** An audio sample entry this app will not promise both platforms can decode. */
  | "audio_codec_unsupported"
  /** `avc1`/`avc3`, but a profile, level, chroma or bit depth outside the policy. */
  | "video_profile_unsupported"
  /** `mp4a`, but not AAC, or an AAC profile outside the policy. */
  | "audio_profile_unsupported"
  /** `mp4a` AAC, but a sample rate or channel count outside the policy. */
  | "audio_format_unsupported"
  /** A sample entry with no decoder configuration to check. Unprovable. */
  | "codec_config_missing"
  /** Two descriptions of the same media that do not agree. Unprovable. */
  | "codec_config_conflict"
  /** Common encryption or another protection scheme. Not playable unprotected. */
  | "track_encrypted"
  /** The file has no audio and no video track at all. */
  | "no_playable_track"
  /** The index could not be located, so nothing about the codecs is provable. */
  | "index_not_found"
  /** Box lengths, nesting or offsets that cannot describe a real file. */
  | "file_malformed"
  /** More nesting, boxes or bytes than a real recording has. Refused, unread. */
  | "probe_limit_exceeded"
  /** Truncated, empty, or otherwise unreadable. */
  | "file_corrupt"
  /** The object is not in storage. */
  | "file_missing"
  /** Storage did not answer in time. **Not** a verdict — retry later. */
  | "probe_timeout"
  /** Storage could not be reached. **Not** a verdict — retry later. */
  | "probe_unavailable"
  /** The object's identity could not be established. **Not** a verdict. */
  | "object_identity_unavailable"
  /** The object changed after it was verified. **Not** a verdict — reprobe. */
  | "object_changed";

export type RenditionVerdict = {
  playable: boolean;
  kind: RenditionKind | null;
  reason: RenditionReason;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  /** RFC 6381 codec string, e.g. `avc1.4d401f`. Null when it was never read. */
  videoProfile: string | null;
  /** RFC 6381 codec string, e.g. `mp4a.40.2`. Null when it was never read. */
  audioProfile: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
};

const EMPTY: Omit<RenditionVerdict, "playable" | "kind" | "reason"> = {
  container: null,
  videoCodec: null,
  audioCodec: null,
  videoProfile: null,
  audioProfile: null,
  audioSampleRate: null,
  audioChannels: null,
};

export function refuse(
  reason: RenditionReason,
  detail: Partial<RenditionVerdict> = {},
): RenditionVerdict {
  return { ...EMPTY, playable: false, kind: null, reason, ...detail };
}

// ---------------------------------------------------------------------------
// What both platforms will be promised
// ---------------------------------------------------------------------------

/**
 * ISO base media brands accepted as portable.
 *
 * The plain ISO family plus the MP4 and AVC brands, which is what MediaMTX and
 * ffmpeg emit for `.mp4`.
 *
 * `qt  ` — QuickTime — is deliberately **absent**. `AVPlayer` plays it happily
 * and ExoPlayer's MP4 extractor usually does, but "usually" is not the standard
 * this gate holds itself to: the promise being made is that both platforms can
 * play it, and a church that hits this can re-encode.
 */
export const PORTABLE_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "mmp4", "M4V ",
]);

/**
 * Video sample entries accepted as portable.
 *
 * H.264 only, in both its out-of-band (`avc1`) and in-band (`avc3`) parameter-set
 * forms. Passing this set is necessary and **not sufficient**: the `avcC` inside
 * decides, and most of the ways a recording fails this gate are inside it.
 *
 * HEVC (`hvc1`/`hev1`) is **deliberately excluded**. iOS 17 decodes it and most
 * modern Android devices do, but Android support is hardware-dependent and
 * `MediaCodec` availability varies by device — so it cannot be promised for
 * *both* platforms from a server-side check. A church whose pipeline produces
 * HEVC keeps the recording; it simply cannot publish it to Faithful until the
 * pipeline emits H.264.
 */
export const PORTABLE_VIDEO_CODECS = new Set(["avc1", "avc3"]);

/**
 * Audio sample entries accepted as portable.
 *
 * AAC only, and again necessary rather than sufficient — an `mp4a` entry can
 * carry MP3. AC-3, E-AC-3 and Opus-in-MP4 each fail on at least one platform.
 */
export const PORTABLE_AUDIO_CODECS = new Set(["mp4a"]);

/** Handler types worth inspecting. A timecode or subtitle track decides nothing. */
const MEDIA_HANDLERS = new Set(["vide", "soun"]);

/**
 * Sample entry types that mean the samples are protected.
 *
 * A protected track is refused outright rather than unwrapped to its original
 * format: Faithful ships no key acquisition and no CDM, so an encrypted
 * rendition is unplayable regardless of what `frma` says was underneath.
 */
const PROTECTED_SAMPLE_ENTRIES = new Set(["encv", "enca", "encs", "enct", "encf", "encm"]);

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Hard ceilings on the walk. Each exists because the input is untrusted.
 *
 * A real `moov` is a handful of levels deep and a few hundred boxes. These are
 * an order of magnitude above anything a recorder produces and far below
 * anything that costs a request measurable time.
 */
export const MAX_BOX_DEPTH = 8;
export const MAX_BOX_COUNT = 4_096;

/**
 * The largest single box this parser will walk *into*.
 *
 * A real `moov` for a three-hour service is a few megabytes at most. A `moov`
 * claiming to be larger than this is either not a `moov` or is an attempt to
 * make the parser do work, and either way there is nothing to gain by reading
 * it. `mdat` is never walked into, so its size is irrelevant here.
 */
export const MAX_CONTAINER_BOX_BYTES = 8 * 1024 * 1024;

/** Descriptor payloads inside `esds`. A real one is tens of bytes. */
const MAX_DESCRIPTOR_BYTES = 4_096;

// ---------------------------------------------------------------------------
// ISO base media parsing
// ---------------------------------------------------------------------------

const MATROSKA_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

type Box = { type: string; start: number; end: number; contentStart: number };

/**
 * Why a walk stopped.
 *
 * `truncated` is not a fault: the head buffer is a prefix of a file, so its last
 * box legitimately runs past the end of what was read. `malformed` and
 * `limit` are faults, and they are kept apart from each other because they say
 * different things to a person — one is a broken file, the other is a file
 * shaped like an attack.
 */
type WalkFault = null | "malformed" | "limit";

type Walk = { boxes: Box[]; fault: WalkFault };

class Budget {
  private boxes = 0;
  exceeded = false;

  spendBox(): boolean {
    this.boxes += 1;
    if (this.boxes > MAX_BOX_COUNT) {
      this.exceeded = true;
      return false;
    }
    return true;
  }
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Unsigned, and never negative: the sign bit of a 32-bit size is still magnitude. */
function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) + bytes[offset + 1];
}

/**
 * Walks the boxes in one region.
 *
 * @param truncatable whether the region is a prefix of something longer. True
 *   for the top level of the head buffer, where the final box (`mdat`, usually)
 *   legitimately extends past what was read. False everywhere inside a box whose
 *   own end is known, where a child running past its parent is **malformed** and
 *   must be reported rather than clamped — clamping is how a parser ends up
 *   reading one box's length and another box's contents.
 */
function walkBoxes(
  bytes: Uint8Array,
  from: number,
  to: number,
  budget: Budget,
  truncatable: boolean,
): Walk {
  const boxes: Box[] = [];
  const limit = Math.min(to, bytes.length);

  if (from < 0 || to < from) return { boxes, fault: "malformed" };

  let offset = from;
  while (offset + 8 <= limit) {
    if (!budget.spendBox()) return { boxes, fault: "limit" };

    let size = readUint32(bytes, offset);
    let headerSize = 8;

    if (size === 1) {
      // A 64-bit `largesize`. The high word is required to be zero: this parser
      // deliberately does not handle boxes above 4 GiB, and a non-zero high word
      // is refused rather than truncated to its low word — truncating would
      // mis-walk the file while looking like it succeeded.
      if (offset + 16 > limit) return { boxes, fault: truncatable ? null : "malformed" };
      if (readUint32(bytes, offset + 8) !== 0) return { boxes, fault: "malformed" };
      size = readUint32(bytes, offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      // "Extends to the end of the enclosing box", which is only meaningful when
      // the enclosing end is actually known.
      if (truncatable) return { boxes, fault: null };
      size = to - offset;
    }

    // A size that cannot cover its own header describes nothing.
    if (size < headerSize) return { boxes, fault: "malformed" };

    // Integer sanity before any arithmetic is trusted. `size` is at most 2^32-1
    // and `offset` is bounded by the buffer, so this cannot silently wrap — but
    // the check is here so it stays true if either ever stops being bounded.
    const end = offset + size;
    if (!Number.isSafeInteger(end) || end <= offset) return { boxes, fault: "malformed" };

    if (end > to) {
      // Past the parent. Legitimate at the top of a prefix; impossible inside a
      // box that declared its own length.
      if (truncatable) {
        boxes.push({
          type: fourcc(bytes, offset + 4),
          start: offset,
          end,
          contentStart: offset + headerSize,
        });
      }
      return { boxes, fault: truncatable ? null : "malformed" };
    }

    boxes.push({
      type: fourcc(bytes, offset + 4),
      start: offset,
      end,
      contentStart: offset + headerSize,
    });
    offset = end;
  }

  // A partial header at the end of a region: fine in a prefix, malformed in a
  // box that claimed to contain exactly this many bytes.
  if (offset !== limit && !truncatable) return { boxes, fault: "malformed" };
  return { boxes, fault: null };
}

/**
 * Walks into a box that is fully present, refusing anything oversized.
 *
 * Every structural walk goes through here rather than calling `walkBoxes`
 * directly, so the depth ceiling and the container-size ceiling cannot be
 * forgotten at one call site.
 */
function children(
  bytes: Uint8Array,
  box: Box,
  budget: Budget,
  depth: number,
): Walk {
  if (depth > MAX_BOX_DEPTH) return { boxes: [], fault: "limit" };
  if (box.end > bytes.length) return { boxes: [], fault: "malformed" };
  if (box.end - box.contentStart > MAX_CONTAINER_BOX_BYTES) return { boxes: [], fault: "limit" };
  return walkBoxes(bytes, box.contentStart, box.end, budget, false);
}

/** The first child of a given type, or null. Faults propagate through `walk.fault`. */
function child(walk: Walk, type: string): Box | null {
  return walk.boxes.find((box) => box.type === type) ?? null;
}

export type FileTypeInfo = { majorBrand: string; compatibleBrands: string[] };

/** Reads `ftyp`. Returns null when the file does not start with one. */
export function readFileType(bytes: Uint8Array): FileTypeInfo | null {
  const walk = walkBoxes(bytes, 0, bytes.length, new Budget(), true);
  const ftyp = walk.boxes.find((box) => box.type === "ftyp");
  if (!ftyp || ftyp.contentStart + 8 > bytes.length) return null;

  const majorBrand = fourcc(bytes, ftyp.contentStart);
  const compatibleBrands: string[] = [];
  const end = Math.min(ftyp.end, bytes.length);
  for (let offset = ftyp.contentStart + 8; offset + 4 <= end; offset += 4) {
    compatibleBrands.push(fourcc(bytes, offset));
  }
  return { majorBrand, compatibleBrands };
}

// ---------------------------------------------------------------------------
// Decoder configuration: video
// ---------------------------------------------------------------------------

export type VideoConfig = {
  profile: number;
  constraints: number;
  level: number;
  chroma: number | null;
  bitDepth: number | null;
  codecString: string;
};

/**
 * Parses an `AVCDecoderConfigurationRecord` — the `avcC` box.
 *
 * This is the authoritative description of an H.264 track. Its first four bytes
 * carry exactly what the portable policy needs to decide, and for the
 * High-profile family it carries chroma format and bit depth as well, so a
 * 10-bit or 4:2:2 stream can be refused without decoding a single SPS bit.
 *
 * Returns `null` for a record that is malformed rather than merely unsupported:
 * the caller distinguishes "this file is broken" from "this encoding is not one
 * we promise", because they mean different things to the church.
 */
export function readAvcConfig(
  bytes: Uint8Array,
  box: Box,
  sampleEntry: string,
): VideoConfig | null {
  const start = box.contentStart;
  if (box.end > bytes.length) return null;
  if (box.end - start < 7) return null;

  if (bytes[start] !== 1) return null; // configurationVersion

  const profile = bytes[start + 1];
  const constraints = bytes[start + 2];
  const level = bytes[start + 3];

  // Six reserved bits set to 1, then lengthSizeMinusOne.
  const lengthSizeMinusOne = bytes[start + 4] & 0b11;
  if (!LEGAL_NAL_LENGTH_SIZES.has(lengthSizeMinusOne)) return null;

  // Parameter sets. Walked so their declared lengths are proved to fit — a
  // record whose SPS claims more bytes than the box holds is malformed, and is
  // exactly the shape of a length-field attack.
  let offset = start + 5;
  const numSps = bytes[offset] & 0b1_1111;
  offset += 1;
  for (let index = 0; index < numSps; index += 1) {
    if (offset + 2 > box.end) return null;
    const length = readUint16(bytes, offset);
    offset += 2 + length;
    if (length === 0 || offset > box.end) return null;
  }

  // `avc1` carries its parameter sets here; `avc3` carries them in-band, so an
  // empty set is legal there and only there.
  if (numSps === 0 && sampleEntry !== "avc3") return null;

  if (offset + 1 > box.end) return null;
  const numPps = bytes[offset];
  offset += 1;
  for (let index = 0; index < numPps; index += 1) {
    if (offset + 2 > box.end) return null;
    const length = readUint16(bytes, offset);
    offset += 2 + length;
    if (length === 0 || offset > box.end) return null;
  }

  let chroma: number | null = null;
  let bitDepth: number | null = null;

  // The High-profile family appends chroma format and bit depths. Present for
  // 100/110/122/144; absent otherwise, and its absence there is not a fault.
  if ([100, 110, 122, 144].includes(profile) && offset + 3 <= box.end) {
    chroma = bytes[offset] & 0b11;
    const lumaMinus8 = bytes[offset + 1] & 0b111;
    const chromaMinus8 = bytes[offset + 2] & 0b111;
    // A file whose luma and chroma depths disagree is not something either
    // platform's hardware path expects, and is refused as malformed.
    if (lumaMinus8 !== chromaMinus8) return null;
    bitDepth = 8 + lumaMinus8;
  }

  return {
    profile,
    constraints,
    level,
    chroma,
    bitDepth,
    codecString: h264CodecString(sampleEntry, profile, constraints, level),
  };
}

// ---------------------------------------------------------------------------
// Decoder configuration: audio
// ---------------------------------------------------------------------------

export type AudioConfig = {
  objectTypeIndication: number;
  audioObjectType: number;
  sampleRate: number | null;
  channels: number;
  codecString: string;
};

/** A bit reader over a byte range. Fails closed by reporting how much it has left. */
class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array, private readonly start: number, private readonly end: number) {}

  remaining(): number {
    return (this.end - this.start) * 8 - this.bit;
  }

  read(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = this.start + (this.bit >> 3);
      if (byte >= this.end) return -1;
      value = (value << 1) | ((this.bytes[byte] >> (7 - (this.bit & 7))) & 1);
      this.bit += 1;
    }
    return value;
  }
}

type Descriptor = { tag: number; contentStart: number; end: number };

/**
 * Reads one MPEG-4 descriptor header.
 *
 * The length is an "expandable" field: up to four bytes, each contributing seven
 * bits, with the top bit meaning "another byte follows". A fifth continuation
 * byte is malformed, and is refused rather than read — an unbounded expandable
 * length is the classic way to walk a parser off the end of a buffer.
 */
function readDescriptor(bytes: Uint8Array, offset: number, end: number): Descriptor | null {
  if (offset + 2 > end) return null;
  const tag = bytes[offset];

  let cursor = offset + 1;
  let length = 0;
  for (let index = 0; index < 4; index += 1) {
    if (cursor >= end) return null;
    const byte = bytes[cursor];
    cursor += 1;
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      if (length > MAX_DESCRIPTOR_BYTES) return null;
      const contentEnd = cursor + length;
      if (contentEnd > end || contentEnd < cursor) return null;
      return { tag, contentStart: cursor, end: contentEnd };
    }
  }
  return null;
}

/**
 * Parses an `esds` box down to the AudioSpecificConfig.
 *
 * `ES_Descriptor` → `DecoderConfigDescriptor` → `DecoderSpecificInfo`. The
 * middle one carries `objectTypeIndication`, which is what separates AAC from
 * the MP3 an `mp4a` entry may legally contain; the last carries the audio object
 * type, sampling frequency and channel configuration.
 *
 * Returns `null` when the structure is malformed. An unsupported *value* is not
 * malformed and comes back as a config the caller then judges.
 */
export function readAudioConfig(bytes: Uint8Array, box: Box): AudioConfig | null {
  if (box.end > bytes.length) return null;
  // version(1) + flags(3)
  let offset = box.contentStart + 4;
  if (offset > box.end) return null;

  const es = readDescriptor(bytes, offset, box.end);
  if (!es || es.tag !== 0x03) return null;

  offset = es.contentStart;
  if (offset + 3 > es.end) return null;
  const flags = bytes[offset + 2];
  offset += 3;
  if (flags & 0x80) offset += 2; // streamDependenceFlag
  if (flags & 0x40) {
    // URL_Flag: a length-prefixed string, checked before it is skipped.
    if (offset >= es.end) return null;
    offset += 1 + bytes[offset];
  }
  if (flags & 0x20) offset += 2; // OCRstreamFlag
  if (offset > es.end) return null;

  const dcd = readDescriptor(bytes, offset, es.end);
  if (!dcd || dcd.tag !== 0x04) return null;
  if (dcd.contentStart + 13 > dcd.end) return null;

  const objectTypeIndication = bytes[dcd.contentStart];
  // objectTypeIndication(1) + streamType/upStream(1) + bufferSizeDB(3)
  // + maxBitrate(4) + avgBitrate(4)
  const dsi = readDescriptor(bytes, dcd.contentStart + 13, dcd.end);
  if (!dsi || dsi.tag !== 0x05) return null;

  const reader = new BitReader(bytes, dsi.contentStart, dsi.end);
  if (reader.remaining() < 16) return null;

  let audioObjectType = reader.read(5);
  if (audioObjectType < 0) return null;
  if (audioObjectType === 31) {
    const escape = reader.read(6);
    if (escape < 0) return null;
    audioObjectType = 32 + escape;
  }

  const frequencyIndex = reader.read(4);
  if (frequencyIndex < 0) return null;

  let sampleRate: number | null;
  if (frequencyIndex === 15) {
    // An explicit 24-bit rate. Read rather than assumed, so an out-of-policy
    // rate signalled this way is caught exactly like an indexed one.
    const explicit = reader.read(24);
    sampleRate = explicit < 0 ? null : explicit;
  } else {
    sampleRate = AAC_SAMPLE_RATES[frequencyIndex] ?? null;
  }

  const channels = reader.read(4);
  if (channels < 0) return null;

  return {
    objectTypeIndication,
    audioObjectType,
    sampleRate,
    channels,
    codecString: aacCodecString(objectTypeIndication, audioObjectType),
  };
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export type TrackDescription = {
  handler: string;
  format: string;
  protected: boolean;
  video: VideoConfig | null;
  audio: AudioConfig | null;
  /** A configuration record that was present but could not be parsed. */
  configMalformed: boolean;
  /** No configuration record where one is required. */
  configMissing: boolean;
};

export type TrackScan = { tracks: TrackDescription[]; fault: WalkFault };

/** Where a sample entry's child boxes begin, past its fixed fields. */
const SAMPLE_ENTRY_HEADER = { vide: 78, soun: 28 } as const;

/**
 * Every video and audio sample entry in a `moov`, with its decoder configuration.
 *
 * Walks `moov → trak → mdia → { hdlr, minf → stbl → stsd → entry → config }`.
 * Tracks whose handler is neither `vide` nor `soun` are skipped, because a
 * timecode or subtitle track has no bearing on whether a phone can play the
 * service.
 *
 * **Every entry in an `stsd` is read, not just the first.** A file can describe
 * the same track two ways, and a parser that reads entry zero and stops can be
 * handed a compliant first entry and an HEVC second one.
 */
export function readTracks(bytes: Uint8Array, moov: Box, budget = new Budget()): TrackScan {
  const tracks: TrackDescription[] = [];
  let fault: WalkFault = null;

  const note = (walk: Walk) => {
    if (walk.fault && !fault) fault = walk.fault;
    return walk;
  };

  const moovWalk = note(children(bytes, moov, budget, 1));
  if (fault) return { tracks, fault };

  // Common encryption's key metadata sits at `moov` level. Its presence means
  // the file is protected even if a sample entry has not been reached yet.
  if (child(moovWalk, "pssh")) {
    return {
      tracks: [{
        handler: "vide", format: "pssh", protected: true,
        video: null, audio: null, configMalformed: false, configMissing: false,
      }],
      fault: null,
    };
  }

  for (const trak of moovWalk.boxes.filter((box) => box.type === "trak")) {
    const trakWalk = note(children(bytes, trak, budget, 2));
    const mdia = child(trakWalk, "mdia");
    if (!mdia) continue;

    const mdiaWalk = note(children(bytes, mdia, budget, 3));
    const hdlr = child(mdiaWalk, "hdlr");
    if (!hdlr || hdlr.contentStart + 12 > bytes.length) continue;
    // version(1) + flags(3) + pre_defined(4), then the handler type.
    const handler = fourcc(bytes, hdlr.contentStart + 8);
    if (!MEDIA_HANDLERS.has(handler)) continue;

    const minf = child(mdiaWalk, "minf");
    if (!minf) continue;
    const stbl = child(note(children(bytes, minf, budget, 4)), "stbl");
    if (!stbl) continue;
    const stsd = child(note(children(bytes, stbl, budget, 5)), "stsd");
    if (!stsd) continue;
    if (stsd.end > bytes.length || stsd.contentStart + 8 > stsd.end) {
      fault = fault ?? "malformed";
      continue;
    }

    // version(1) + flags(3) + entry_count(4), then the sample entries.
    const declaredEntries = readUint32(bytes, stsd.contentStart + 4);
    const entries = walkBoxes(bytes, stsd.contentStart + 8, stsd.end, budget, false);
    note(entries);
    // A count that does not match what is there is a description of a file that
    // does not exist. Refused rather than reconciled.
    if (declaredEntries !== entries.boxes.length) {
      fault = fault ?? "malformed";
      continue;
    }

    for (const entry of entries.boxes) {
      tracks.push(describeEntry(bytes, entry, handler, budget));
    }
  }

  return { tracks, fault };
}

function describeEntry(
  bytes: Uint8Array,
  entry: Box,
  handler: string,
  budget: Budget,
): TrackDescription {
  const base: TrackDescription = {
    handler,
    format: entry.type,
    protected: PROTECTED_SAMPLE_ENTRIES.has(entry.type),
    video: null,
    audio: null,
    configMalformed: false,
    configMissing: false,
  };
  if (base.protected) return base;

  const headerSize = SAMPLE_ENTRY_HEADER[handler as keyof typeof SAMPLE_ENTRY_HEADER];
  const configStart = entry.contentStart + headerSize;
  if (configStart >= entry.end || entry.end > bytes.length) {
    // A sample entry too short to hold its own fixed fields.
    return { ...base, configMissing: true };
  }

  const inner = walkBoxes(bytes, configStart, entry.end, budget, false);
  if (inner.fault) return { ...base, configMalformed: true };

  // `sinf` inside an otherwise ordinary entry is the other way a protected
  // track presents itself.
  if (child(inner, "sinf")) return { ...base, protected: true };

  if (handler === "vide") {
    if (!PORTABLE_VIDEO_CODECS.has(entry.type)) return base;
    const avcC = child(inner, "avcC");
    if (!avcC) return { ...base, configMissing: true };
    const video = readAvcConfig(bytes, avcC, entry.type);
    return video ? { ...base, video } : { ...base, configMalformed: true };
  }

  if (!PORTABLE_AUDIO_CODECS.has(entry.type)) return base;
  const esds = child(inner, "esds");
  if (!esds) return { ...base, configMissing: true };
  const audio = readAudioConfig(bytes, esds);
  return audio ? { ...base, audio } : { ...base, configMalformed: true };
}

/**
 * Locates `moov`.
 *
 * A faststart file has it near the front; a file written straight through has
 * it at the end. Both are read, because a recording that is merely not
 * faststart is perfectly playable and refusing it would be wrong.
 */
export function locateMoov(head: Uint8Array, tail: Uint8Array | null): {
  bytes: Uint8Array;
  box: Box;
} | null {
  const budget = new Budget();
  const walk = walkBoxes(head, 0, head.length, budget, true);
  const inHead = walk.boxes.find((box) => box.type === "moov");
  // Only usable if the whole box is inside what was read; a `moov` whose
  // contents run past the prefix would parse into nonsense.
  if (inHead && inHead.end <= head.length) return { bytes: head, box: inHead };

  if (!tail) return null;

  // The tail is a window into the middle of the file, so a box walk from zero
  // is meaningless. Scan for the type and validate the size that precedes it.
  for (let offset = 0; offset + 8 <= tail.length; offset += 1) {
    if (fourcc(tail, offset + 4) !== "moov") continue;
    const size = readUint32(tail, offset);
    if (size < 8 || size > MAX_CONTAINER_BOX_BYTES) continue;
    if (offset + size > tail.length) continue;

    const box: Box = {
      type: "moov",
      start: offset,
      end: offset + size,
      contentStart: offset + 8,
    };
    // A real `moov` contains an `mvhd`. Requiring it rejects the fourcc
    // appearing by chance inside media data.
    const inner = walkBoxes(tail, box.contentStart, box.end, new Budget(), false);
    if (!inner.fault && child(inner, "mvhd")) return { bytes: tail, box };
  }

  return null;
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/** Whether one video track conforms to the portable policy. */
function judgeVideo(config: VideoConfig): RenditionReason | null {
  if (!PORTABLE_H264_PROFILES.has(config.profile)) return "video_profile_unsupported";
  if (config.level > MAX_H264_LEVEL) return "video_profile_unsupported";
  if (config.chroma !== null && config.chroma !== PORTABLE_H264_CHROMA) {
    return "video_profile_unsupported";
  }
  if (config.bitDepth !== null && config.bitDepth !== PORTABLE_H264_BIT_DEPTH) {
    return "video_profile_unsupported";
  }
  return null;
}

/** Whether one audio track conforms to the portable policy. */
function judgeAudio(config: AudioConfig): RenditionReason | null {
  if (config.objectTypeIndication !== MPEG4_AUDIO_OBJECT_TYPE_INDICATION) {
    return "audio_profile_unsupported";
  }
  if (!PORTABLE_AAC_OBJECT_TYPES.has(config.audioObjectType)) {
    return "audio_profile_unsupported";
  }
  if (
    config.sampleRate === null ||
    config.sampleRate < MIN_AUDIO_SAMPLE_RATE ||
    config.sampleRate > MAX_AUDIO_SAMPLE_RATE
  ) {
    return "audio_format_unsupported";
  }
  if (!PORTABLE_AUDIO_CHANNELS.has(config.channels)) return "audio_format_unsupported";
  return null;
}

/**
 * Decides whether a recording may be published to Faithful.
 *
 * The order of the checks is the order in which a person would want to be told:
 * the container first, then which codecs, then how those codecs are configured.
 * Each step is a refusal that names what to fix.
 *
 * @param head the first bytes of the object
 * @param tail the last bytes, when the index was not in the head
 */
export function assessRendition(
  head: Uint8Array,
  tail: Uint8Array | null = null,
): RenditionVerdict {
  if (head.length < 16) return refuse("file_corrupt");

  if (MATROSKA_MAGIC.every((byte, index) => head[index] === byte)) {
    // The case this whole gate exists for. `sanitizeRecordingFilename` permits
    // `.mkv`, `AVPlayer` cannot decode it, and until this gate a pastor could
    // publish one and a congregation could not watch it.
    return refuse("container_matroska", { container: "matroska" });
  }

  const fileType = readFileType(head);
  if (!fileType) return refuse("container_unrecognised");
  const container = fileType.majorBrand;

  const brands = [fileType.majorBrand, ...fileType.compatibleBrands];
  if (!brands.some((brand) => PORTABLE_BRANDS.has(brand))) {
    return refuse("container_brand_unsupported", { container });
  }

  const moov = locateMoov(head, tail);
  // Without the index nothing about the codecs is provable, and an unprovable
  // recording is not publishable. Failing closed is the point.
  if (!moov) return refuse("index_not_found", { container });

  const scan = readTracks(moov.bytes, moov.box);
  if (scan.fault === "limit") return refuse("probe_limit_exceeded", { container });
  if (scan.fault === "malformed") return refuse("file_malformed", { container });

  if (scan.tracks.some((track) => track.protected)) {
    return refuse("track_encrypted", { container });
  }

  const video = scan.tracks.filter((track) => track.handler === "vide");
  const audio = scan.tracks.filter((track) => track.handler === "soun");

  if (video.length === 0 && audio.length === 0) {
    return refuse("no_playable_track", { container });
  }

  // Two descriptions of the same medium that disagree. Whichever a device picks,
  // this server cannot say which, so it cannot promise either.
  const distinct = (tracks: TrackDescription[]) => new Set(tracks.map((track) => track.format));
  if (distinct(video).size > 1 || distinct(audio).size > 1) {
    return refuse("codec_config_conflict", { container });
  }

  const badVideo = video.find((track) => !PORTABLE_VIDEO_CODECS.has(track.format));
  if (badVideo) {
    return refuse("video_codec_unsupported", {
      container,
      videoCodec: badVideo.format,
      audioCodec: audio[0]?.format ?? null,
    });
  }

  const badAudio = audio.find((track) => !PORTABLE_AUDIO_CODECS.has(track.format));
  if (badAudio) {
    return refuse("audio_codec_unsupported", {
      container,
      videoCodec: video[0]?.format ?? null,
      audioCodec: badAudio.format,
    });
  }

  const codecs = { videoCodec: video[0]?.format ?? null, audioCodec: audio[0]?.format ?? null };

  if ([...video, ...audio].some((track) => track.configMalformed)) {
    return refuse("file_malformed", { container, ...codecs });
  }
  if ([...video, ...audio].some((track) => track.configMissing)) {
    return refuse("codec_config_missing", { container, ...codecs });
  }

  // Two configurations for the same medium that describe different encodings.
  const videoConfigs = new Set(video.map((track) => track.video?.codecString));
  const audioConfigs = new Set(audio.map((track) => track.audio?.codecString));
  if (videoConfigs.size > 1 || audioConfigs.size > 1) {
    return refuse("codec_config_conflict", { container, ...codecs });
  }

  const videoConfig = video[0]?.video ?? null;
  const audioConfig = audio[0]?.audio ?? null;
  const profiles = {
    videoProfile: videoConfig?.codecString ?? null,
    audioProfile: audioConfig?.codecString ?? null,
    audioSampleRate: audioConfig?.sampleRate ?? null,
    audioChannels: audioConfig?.channels ?? null,
  };

  if (videoConfig) {
    const verdict = judgeVideo(videoConfig);
    if (verdict) return refuse(verdict, { container, ...codecs, ...profiles });
  }
  if (audioConfig) {
    const verdict = judgeAudio(audioConfig);
    if (verdict) return refuse(verdict, { container, ...codecs, ...profiles });
  }

  return {
    playable: true,
    kind: "progressive",
    reason: "ok",
    container,
    ...codecs,
    ...profiles,
  };
}

/**
 * What a staff member reads.
 *
 * Deliberately says what to do, and deliberately does **not** name a fourcc, a
 * profile, a brand, a storage path or a provider. Those live in the row for
 * support to read; a pastor needs to know whether to re-record, change a
 * setting, wait, or call someone.
 *
 * A visitor never sees any of this: an ineligible recording is simply not in
 * their list.
 */
export function staffExplanation(reason: RenditionReason): string {
  switch (reason) {
    case "ok":
      return "Ready for the Faithful app.";
    case "container_matroska":
    case "container_unrecognised":
    case "container_brand_unsupported":
      return "This recording is in a format phones can't play. It needs to be re-recorded or converted before it can go in the app.";
    case "video_codec_unsupported":
    case "audio_codec_unsupported":
      return "This recording uses video or audio that not every phone can play. It needs converting before it can go in the app.";
    case "video_profile_unsupported":
    case "audio_profile_unsupported":
    case "audio_format_unsupported":
      return "This recording's video or audio settings are outside what every phone can play. Check the streaming box's encoder settings, then record or upload it again.";
    case "codec_config_missing":
    case "codec_config_conflict":
      return "Faithful can't tell how this recording was encoded, so it can't promise phones will play it. It needs re-recording or converting.";
    case "track_encrypted":
      return "This recording is protected, and the app has no way to unlock it.";
    case "no_playable_track":
      return "This recording has no video or audio in it.";
    case "index_not_found":
    case "file_corrupt":
      return "This recording didn't finish uploading properly. Re-upload it from the streaming box and try again.";
    case "file_malformed":
    case "probe_limit_exceeded":
      return "This recording's file is damaged or isn't really a video. Re-record it or upload it again.";
    case "file_missing":
      return "The file for this recording is no longer in storage.";
    case "object_changed":
      return "This recording's file changed after it was checked. Faithful is checking it again.";
    case "object_identity_unavailable":
    case "probe_timeout":
    case "probe_unavailable":
      return "Faithful couldn't check this recording just now. Try again in a few minutes.";
  }
}

/**
 * Whether a refusal is worth retrying.
 *
 * A codec will not change on its own; storage being slow will. `object_changed`
 * is transient in the same sense: the file is different now, and the next probe
 * will say what it is.
 */
export function isTransientRefusal(reason: RenditionReason): boolean {
  return (
    reason === "probe_unavailable" ||
    reason === "probe_timeout" ||
    reason === "object_identity_unavailable" ||
    reason === "object_changed"
  );
}
