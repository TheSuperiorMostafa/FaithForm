import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BOX_DEPTH,
  PORTABLE_AUDIO_CODECS,
  PORTABLE_BRANDS,
  PORTABLE_VIDEO_CODECS,
  assessRendition,
  isTransientRefusal,
  locateMoov,
  readFileType,
  staffExplanation,
  type RenditionReason,
} from "@/lib/media/v1/rendition";
import {
  MAX_H264_LEVEL,
  PORTABLE_AAC_OBJECT_TYPES,
  PORTABLE_H264_PROFILES,
} from "@/lib/media/v1/portable-profile";

/**
 * The eligibility parser, against **real byte structures**.
 *
 * Every fixture below is an actual ISO base media file laid out box by box, or
 * an actual Matroska header — not a stub returning a verdict. The parser is the
 * only thing standing between "the backend has a file" and "a congregation can
 * watch it", so testing it against anything other than bytes would be testing
 * the wrong thing.
 */

// ---------------------------------------------------------------------------
// Building files
// ---------------------------------------------------------------------------

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = children.reduce((total, child) => total + child.length, 0);
  const out = new Uint8Array(8 + body);
  const size = out.length;
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);

  let offset = 8;
  for (const child of children) {
    out.set(child, offset);
    offset += child.length;
  }
  return out;
}

function raw(...values: (string | number[] | Uint8Array)[]): Uint8Array {
  const parts = values.map((value) =>
    typeof value === "string"
      ? Uint8Array.from([...value].map((character) => character.charCodeAt(0)))
      : value instanceof Uint8Array
        ? value
        : Uint8Array.from(value),
  );
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const zeros = (count: number) => new Uint8Array(count);

function ftyp(major = "isom", compatible: string[] = ["isom", "iso2", "avc1", "mp41"]) {
  return box("ftyp", raw(major), zeros(4), raw(compatible.join("")));
}

// ---------------------------------------------------------------------------
// Decoder configuration records
// ---------------------------------------------------------------------------
//
// The parser decides from these, not from the fourcc, so the fixtures have to
// contain real ones. Every field below is laid out to the spec byte order,
// because a fixture that is merely "about the right shape" would prove the
// parser tolerant rather than correct.

const H264 = { BASELINE: 66, MAIN: 77, HIGH: 100, HIGH_10: 110, HIGH_422: 122, HIGH_444: 244 };

type AvcOptions = {
  profile?: number;
  constraints?: number;
  level?: number;
  /** Present only for the High family, exactly as the specification has it. */
  chroma?: number;
  bitDepth?: number;
  spsCount?: number;
  ppsCount?: number;
  lengthSizeMinusOne?: number;
  version?: number;
  /** Declares an SPS longer than the bytes that follow it. */
  lyingSpsLength?: number;
};

/** An `AVCDecoderConfigurationRecord`. */
function avcC(options: AvcOptions = {}): Uint8Array {
  const {
    profile = H264.MAIN,
    constraints = 0x40,
    level = 31,
    spsCount = 1,
    ppsCount = 1,
    lengthSizeMinusOne = 3,
    version = 1,
    lyingSpsLength,
  } = options;

  const parts: number[] = [
    version,
    profile,
    constraints,
    level,
    0xfc | lengthSizeMinusOne,
    0xe0 | spsCount,
  ];

  for (let index = 0; index < spsCount; index += 1) {
    const sps = [0x67, 0x4d, 0x40, 0x1f];
    const declared = lyingSpsLength ?? sps.length;
    parts.push((declared >> 8) & 0xff, declared & 0xff, ...sps);
  }

  parts.push(ppsCount);
  for (let index = 0; index < ppsCount; index += 1) {
    const pps = [0x68, 0xee, 0x3c, 0x80];
    parts.push(0, pps.length, ...pps);
  }

  // The High family appends chroma format and bit depths.
  if ([H264.HIGH, H264.HIGH_10, H264.HIGH_422, 144].includes(profile)) {
    const chroma = options.chroma ?? 1;
    const depth = (options.bitDepth ?? 8) - 8;
    parts.push(0xfc | chroma, 0xf8 | depth, 0xf8 | depth, 0);
  }

  return box("avcC", Uint8Array.from(parts));
}

/** Writes bits most-significant first, the way an AudioSpecificConfig is read. */
class Bits {
  private bits: number[] = [];
  write(value: number, count: number): this {
    for (let index = count - 1; index >= 0; index -= 1) this.bits.push((value >> index) & 1);
    return this;
  }
  bytes(): Uint8Array {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
    const out = new Uint8Array(this.bits.length / 8);
    this.bits.forEach((bit, index) => {
      out[index >> 3] |= bit << (7 - (index & 7));
    });
    return out;
  }
}

/** An MPEG-4 descriptor: tag, an expandable length, then the payload. */
function descriptor(tag: number, payload: Uint8Array, lengthBytes = 1): Uint8Array {
  const length: number[] = [];
  if (lengthBytes === 1) {
    length.push(payload.length);
  } else {
    // The multi-byte form: seven bits each, continuation bit on all but the last.
    for (let index = lengthBytes - 1; index >= 0; index -= 1) {
      const chunk = (payload.length >> (7 * index)) & 0x7f;
      length.push(index === 0 ? chunk : chunk | 0x80);
    }
  }
  return raw([tag, ...length], payload);
}

type AudioOptions = {
  objectTypeIndication?: number;
  audioObjectType?: number;
  /** Index into the AAC sampling-frequency table; 15 means an explicit rate. */
  frequencyIndex?: number;
  explicitRate?: number;
  channels?: number;
  /** A length prefix claiming more bytes than the descriptor holds. */
  lengthBytes?: number;
};

/** An `esds` box down to a real AudioSpecificConfig. */
function esds(options: AudioOptions = {}): Uint8Array {
  const {
    objectTypeIndication = 0x40,
    audioObjectType = 2,
    frequencyIndex = 3, // 48 kHz
    channels = 2,
    lengthBytes = 1,
  } = options;

  const config = new Bits();
  if (audioObjectType >= 31) config.write(31, 5).write(audioObjectType - 32, 6);
  else config.write(audioObjectType, 5);
  config.write(frequencyIndex, 4);
  if (frequencyIndex === 15) config.write(options.explicitRate ?? 48_000, 24);
  config.write(channels, 4);

  const dsi = descriptor(0x05, config.bytes(), lengthBytes);
  const dcd = descriptor(
    0x04,
    raw(
      [objectTypeIndication, 0x15], // objectTypeIndication, streamType/upStream
      zeros(3), // bufferSizeDB
      zeros(4), // maxBitrate
      zeros(4), // avgBitrate
      dsi,
    ),
  );
  const es = descriptor(0x03, raw([0, 1, 0], dcd)); // ES_ID, flags

  return box("esds", zeros(4), es);
}

/** A `VisualSampleEntry`: 78 fixed bytes, then its configuration boxes. */
function visualEntry(format: string, ...children: Uint8Array[]) {
  return box(format, zeros(78), ...children);
}

/** An `AudioSampleEntry`: 28 fixed bytes, then its configuration boxes. */
function audioEntry(format: string, ...children: Uint8Array[]) {
  return box(format, zeros(28), ...children);
}

/**
 * The configuration a sample entry of this kind carries by default.
 *
 * A portable one, so every fixture that is not about configuration gets a valid
 * one without saying so.
 */
function defaultEntry(handler: string, format: string): Uint8Array {
  if (handler === "vide") {
    return PORTABLE_VIDEO_CODECS.has(format)
      ? visualEntry(format, avcC())
      : visualEntry(format);
  }
  if (handler === "soun") {
    return PORTABLE_AUDIO_CODECS.has(format) ? audioEntry(format, esds()) : audioEntry(format);
  }
  return box(format, zeros(8));
}

/** One `trak`, with the handler and sample-entry fourcc it should report. */
function trak(handler: string, format: string, ...entries: Uint8Array[]) {
  const sampleEntries = entries.length > 0 ? entries : [defaultEntry(handler, format)];
  const stsd = box(
    "stsd",
    zeros(4), // version + flags
    raw([0, 0, 0, sampleEntries.length]), // entry_count
    ...sampleEntries,
  );
  return box(
    "trak",
    box(
      "mdia",
      // hdlr: version(1) flags(3) pre_defined(4) handler_type(4)
      box("hdlr", zeros(8), raw(handler), zeros(12)),
      box("minf", box("stbl", stsd)),
    ),
  );
}

function moov(...traks: Uint8Array[]) {
  return box("moov", box("mvhd", zeros(96)), ...traks);
}

/** A faststart file: `moov` before the media data. */
function faststart(
  traks: Uint8Array[],
  brand = "isom",
  compatible: string[] = ["isom", "iso2", "avc1", "mp41"],
) {
  return raw(ftyp(brand, compatible), moov(...traks), box("mdat", zeros(2048)));
}

/** A straight-through file: `moov` after the media data. */
function tailIndexed(traks: Uint8Array[], mdatBytes = 4096, brand = "isom") {
  return raw(ftyp(brand), box("mdat", zeros(mdatBytes)), moov(...traks));
}

const H264_AAC = () => [trak("vide", "avc1"), trak("soun", "mp4a")];

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a faststart H.264 + AAC recording is publishable", () => {
  const verdict = assessRendition(faststart(H264_AAC()));

  assert.equal(verdict.playable, true);
  assert.equal(verdict.reason, "ok");
  assert.equal(verdict.kind, "progressive");
  assert.equal(verdict.container, "isom");
  assert.equal(verdict.videoCodec, "avc1");
  assert.equal(verdict.audioCodec, "mp4a");
});

test("a straight-through recording is publishable too", () => {
  // A file that is merely not faststart is perfectly playable; refusing it
  // would block most of what a relay writes.
  const file = tailIndexed(H264_AAC());
  const head = file.subarray(0, 64);
  const tail = file.subarray(Math.max(0, file.length - 512));

  // The head alone cannot prove the codecs.
  assert.equal(assessRendition(head).reason, "index_not_found");
  // With the tail it can.
  assert.equal(assessRendition(head, tail).playable, true);
});

test("out-of-band H.264 parameter sets are accepted", () => {
  const verdict = assessRendition(faststart([trak("vide", "avc3"), trak("soun", "mp4a")]));
  assert.equal(verdict.playable, true);
  assert.equal(verdict.videoCodec, "avc3");
});

test("every portable brand is accepted", () => {
  for (const brand of PORTABLE_BRANDS) {
    // Declared as the *only* brand, so each is genuinely carrying the file.
    const verdict = assessRendition(faststart(H264_AAC(), brand, [brand]));
    assert.equal(verdict.playable, true, brand);
  }
});

test("a compatible brand counts, even when the major brand is exotic", () => {
  // A file whose major brand is `qt  ` but which declares `isom` compatibility
  // really is ISO-compatible — that is what the compatible-brands list is for,
  // and both platforms will play it. Refusing on the major brand alone would
  // reject files that are fine.
  const verdict = assessRendition(faststart(H264_AAC(), "qt  ", ["qt  ", "isom"]));
  assert.equal(verdict.playable, true);
});

test("a video-only or audio-only recording still plays", () => {
  assert.equal(assessRendition(faststart([trak("vide", "avc1")])).playable, true);
  assert.equal(assessRendition(faststart([trak("soun", "mp4a")])).playable, true);
});

test("a timecode or subtitle track does not decide anything", () => {
  // ffmpeg and MediaMTX both add tracks a phone ignores. Rejecting on one would
  // block recordings that play perfectly.
  const verdict = assessRendition(
    faststart([trak("vide", "avc1"), trak("soun", "mp4a"), trak("tmcd", "tmcd"), trak("text", "tx3g")]),
  );
  assert.equal(verdict.playable, true);
});

// ---------------------------------------------------------------------------
// The codec configuration, not the label
// ---------------------------------------------------------------------------
//
// Everything in this section carries a sample entry the previous version of this
// gate accepted. `avc1` is `avc1` whether the stream is Baseline 3.0 or High
// 4:4:4 10-bit, and `mp4a` is `mp4a` whether the payload is AAC-LC or MP3.

test("the same avc1 label, a profile no phone is promised", () => {
  for (const profile of [H264.HIGH_10, H264.HIGH_422, H264.HIGH_444, 44, 83, 86, 118, 128]) {
    const verdict = assessRendition(
      faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ profile }))), trak("soun", "mp4a")]),
    );
    assert.equal(verdict.playable, false, `profile ${profile}`);
    assert.equal(verdict.reason, "video_profile_unsupported", `profile ${profile}`);
    // The fourcc is still the portable one. Only the configuration refused it.
    assert.equal(verdict.videoCodec, "avc1");
  }
});

test("the same avc1 label, a level above the ceiling", () => {
  // 4.2 is the ceiling. 5.0 and up is 4K territory, where Android decoder
  // support genuinely varies by device and no server-side claim is honest.
  for (const level of [MAX_H264_LEVEL + 1, 50, 51, 52, 60, 62]) {
    const verdict = assessRendition(
      faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ level })))]),
    );
    assert.equal(verdict.playable, false, `level ${level}`);
    assert.equal(verdict.reason, "video_profile_unsupported", `level ${level}`);
  }

  // And the ceiling itself is inside the policy, not outside it.
  const atCeiling = assessRendition(
    faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ level: MAX_H264_LEVEL })))]),
  );
  assert.equal(atCeiling.playable, true);
});

test("every portable H.264 profile is accepted, and reported as a codec string", () => {
  for (const profile of PORTABLE_H264_PROFILES) {
    const verdict = assessRendition(
      faststart([
        trak("vide", "avc1", visualEntry("avc1", avcC({ profile, constraints: 0, level: 31 }))),
        trak("soun", "mp4a"),
      ]),
    );
    assert.equal(verdict.playable, true, `profile ${profile}`);
    // RFC 6381 — the form both platforms' own documentation and `MediaCodec` use.
    assert.equal(verdict.videoProfile, `avc1.${profile.toString(16)}001f`);
  }
});

test("10-bit and 4:2:2 are refused from the avcC extension, without decoding an SPS", () => {
  // What a broadcast-grade capture card produces by default. Both platforms'
  // *software* decoders may cope while the hardware path does not.
  const tenBit = assessRendition(
    faststart([
      trak("vide", "avc1", visualEntry("avc1", avcC({ profile: H264.HIGH, bitDepth: 10 }))),
    ]),
  );
  assert.equal(tenBit.reason, "video_profile_unsupported");

  const fourTwoTwo = assessRendition(
    faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ profile: H264.HIGH, chroma: 2 })))]),
  );
  assert.equal(fourTwoTwo.reason, "video_profile_unsupported");
});

test("an mp4a entry carrying MP3 is refused", () => {
  // Legal in the container, and exactly what a fourcc check misses: the box says
  // `mp4a` and the payload is not what either platform is being promised.
  for (const oti of [0x69, 0x6b, 0x66, 0x67]) {
    const verdict = assessRendition(
      faststart([
        trak("vide", "avc1"),
        trak("soun", "mp4a", audioEntry("mp4a", esds({ objectTypeIndication: oti }))),
      ]),
    );
    assert.equal(verdict.playable, false, `oti ${oti}`);
    assert.equal(verdict.reason, "audio_profile_unsupported");
    assert.equal(verdict.audioCodec, "mp4a");
  }
});

test("an unsupported AAC object type is refused", () => {
  // AAC-LTP, AAC Scalable, AAC-ELD and xHE-AAC. The last is the interesting one:
  // iOS 13+ and Android 9+ decode it, but this app's floor is Android 8.0.
  for (const aot of [4, 6, 17, 39, 42]) {
    const verdict = assessRendition(
      faststart([trak("soun", "mp4a", audioEntry("mp4a", esds({ audioObjectType: aot })))]),
    );
    assert.equal(verdict.playable, false, `aot ${aot}`);
    assert.equal(verdict.reason, "audio_profile_unsupported");
  }

  for (const aot of PORTABLE_AAC_OBJECT_TYPES) {
    const verdict = assessRendition(
      faststart([trak("soun", "mp4a", audioEntry("mp4a", esds({ audioObjectType: aot })))]),
    );
    assert.equal(verdict.playable, true, `aot ${aot}`);
    assert.equal(verdict.audioProfile, `mp4a.40.${aot}`);
  }
});

test("a sample rate or channel count outside the bounds is refused", () => {
  // 96, 88.2 and 64 kHz are above Android's stated AAC-LC range, and are what a
  // misconfigured audio interface produces.
  for (const frequencyIndex of [0, 1, 2]) {
    const verdict = assessRendition(
      faststart([trak("soun", "mp4a", audioEntry("mp4a", esds({ frequencyIndex })))]),
    );
    assert.equal(verdict.reason, "audio_format_unsupported", `index ${frequencyIndex}`);
  }

  // An explicitly signalled rate is judged exactly like an indexed one, so the
  // escape value is not a way around the policy.
  const explicit = assessRendition(
    faststart([
      trak("soun", "mp4a", audioEntry("mp4a", esds({ frequencyIndex: 15, explicitRate: 96_000 }))),
    ]),
  );
  assert.equal(explicit.reason, "audio_format_unsupported");

  // 5.1, and "defined in the program config element" — a channel count that is
  // not provable from the configuration at all.
  for (const channels of [0, 6, 8]) {
    const verdict = assessRendition(
      faststart([trak("soun", "mp4a", audioEntry("mp4a", esds({ channels })))]),
    );
    assert.equal(verdict.reason, "audio_format_unsupported", `channels ${channels}`);
  }

  const stereo = assessRendition(
    faststart([trak("soun", "mp4a", audioEntry("mp4a", esds({ channels: 2 })))]),
  );
  assert.equal(stereo.playable, true);
  assert.equal(stereo.audioSampleRate, 48_000);
  assert.equal(stereo.audioChannels, 2);
});

test("a sample entry with no decoder configuration is unprovable, not assumed good", () => {
  const noAvcC = assessRendition(faststart([trak("vide", "avc1", visualEntry("avc1"))]));
  assert.equal(noAvcC.playable, false);
  assert.equal(noAvcC.reason, "codec_config_missing");

  const noEsds = assessRendition(faststart([trak("soun", "mp4a", audioEntry("mp4a"))]));
  assert.equal(noEsds.playable, false);
  assert.equal(noEsds.reason, "codec_config_missing");
});

test("avc3 may omit its parameter sets; avc1 may not", () => {
  // `avc3` carries them in-band, so an empty set is legal there and only there.
  const inBand = assessRendition(
    faststart([trak("vide", "avc3", visualEntry("avc3", avcC({ spsCount: 0 })))]),
  );
  assert.equal(inBand.playable, true);

  const outOfBand = assessRendition(
    faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ spsCount: 0 })))]),
  );
  assert.equal(outOfBand.playable, false);
  assert.equal(outOfBand.reason, "file_malformed");
});

// ---------------------------------------------------------------------------
// Protected content
// ---------------------------------------------------------------------------

test("an encrypted sample entry cannot be published", () => {
  // Faithful ships no key acquisition and no CDM, so an encrypted rendition is
  // unplayable whatever `frma` says was underneath.
  for (const format of ["encv", "enca"]) {
    const handler = format === "encv" ? "vide" : "soun";
    const verdict = assessRendition(faststart([trak(handler, format, box(format, zeros(78)))]));
    assert.equal(verdict.playable, false, format);
    assert.equal(verdict.reason, "track_encrypted");
  }
});

test("a sinf inside an ordinary-looking entry is still protection", () => {
  // The other way a protected track presents itself: the fourcc is `avc1`, the
  // configuration is valid, and the samples are encrypted anyway.
  const verdict = assessRendition(
    faststart([
      trak("vide", "avc1", visualEntry("avc1", avcC(), box("sinf", box("frma", raw("avc1"))))),
    ]),
  );
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "track_encrypted");
});

test("common encryption key metadata at moov level is protection", () => {
  const file = raw(
    ftyp(),
    box("moov", box("mvhd", zeros(96)), box("pssh", zeros(32)), ...H264_AAC()),
    box("mdat", zeros(512)),
  );
  assert.equal(assessRendition(file).reason, "track_encrypted");
});

// ---------------------------------------------------------------------------
// Two descriptions that disagree
// ---------------------------------------------------------------------------

test("an stsd whose entries disagree is unprovable", () => {
  // A compliant first entry and an HEVC second one. A parser that reads entry
  // zero and stops would call this playable.
  const conflicted = trak(
    "vide",
    "avc1",
    visualEntry("avc1", avcC()),
    visualEntry("hvc1"),
  );
  const verdict = assessRendition(faststart([conflicted, trak("soun", "mp4a")]));
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "codec_config_conflict");
});

test("two video tracks with different configurations are unprovable", () => {
  const verdict = assessRendition(
    faststart([
      trak("vide", "avc1", visualEntry("avc1", avcC({ profile: H264.MAIN }))),
      trak("vide", "avc1", visualEntry("avc1", avcC({ profile: H264.BASELINE }))),
    ]),
  );
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "codec_config_conflict");
});

test("an stsd entry count that does not match its entries is malformed", () => {
  // A description of a file that does not exist. Refused rather than reconciled.
  const stsd = box("stsd", zeros(4), raw([0, 0, 0, 7]), visualEntry("avc1", avcC()));
  const lying = box(
    "trak",
    box("mdia", box("hdlr", zeros(8), raw("vide"), zeros(12)), box("minf", box("stbl", stsd))),
  );
  assert.equal(assessRendition(faststart([lying])).reason, "file_malformed");
});

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

test("Matroska cannot be published", () => {
  // **The case this gate exists for.** `sanitizeRecordingFilename` permits
  // `.mkv` and `AVPlayer` cannot decode it, so a pastor could publish one and a
  // congregation could not watch it.
  const mkv = raw([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86, 0x81, 0x01], zeros(64));
  const verdict = assessRendition(mkv);

  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "container_matroska");
  assert.equal(verdict.container, "matroska");
});

test("an unrecognised container cannot be published", () => {
  for (const junk of [
    raw("RIFF", zeros(32)),
    raw("OggS", zeros(32)),
    raw([0x1f, 0x8b, 0x08, 0x00], zeros(32)),
    new Uint8Array(64),
  ]) {
    const verdict = assessRendition(junk);
    assert.equal(verdict.playable, false);
    assert.ok(
      verdict.reason === "container_unrecognised" || verdict.reason === "index_not_found",
      verdict.reason,
    );
  }
});

test("a QuickTime-only file is refused, deliberately", () => {
  // No ISO brand anywhere in the file. `AVPlayer` plays it and ExoPlayer
  // usually does — but "usually" is not the standard this gate holds itself to:
  // the promise is that *both* platforms can play it.
  const verdict = assessRendition(faststart(H264_AAC(), "qt  ", ["qt  "]));
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "container_brand_unsupported");
  assert.equal(verdict.container, "qt  ");
});

test("HEVC is refused, deliberately", () => {
  for (const codec of ["hvc1", "hev1"]) {
    const verdict = assessRendition(faststart([trak("vide", codec), trak("soun", "mp4a")]));
    // iOS decodes it; Android support is hardware-dependent. A server-side
    // check cannot promise both, so it does not.
    assert.equal(verdict.playable, false, codec);
    assert.equal(verdict.reason, "video_codec_unsupported");
    assert.equal(verdict.videoCodec, codec);
  }
});

test("non-portable audio is refused", () => {
  for (const codec of ["ac-3", "ec-3", "Opus", "fLaC"]) {
    const verdict = assessRendition(faststart([trak("vide", "avc1"), trak("soun", codec)]));
    assert.equal(verdict.playable, false, codec);
    assert.equal(verdict.reason, "audio_codec_unsupported");
    assert.equal(verdict.audioCodec, codec);
  }
});

test("a file with no media track at all is refused", () => {
  const verdict = assessRendition(faststart([trak("tmcd", "tmcd")]));
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "no_playable_track");
});

test("a truncated file is refused rather than guessed at", () => {
  const file = faststart(H264_AAC());
  assert.equal(assessRendition(file.subarray(0, 8)).reason, "file_corrupt");
  assert.equal(assessRendition(new Uint8Array(0)).reason, "file_corrupt");

  // Long enough to read an ftyp, too short to hold an index.
  const headOnly = file.subarray(0, 40);
  assert.equal(assessRendition(headOnly).playable, false);
});

test("a moov that runs past what was read is not parsed", () => {
  // Half a box is worse than no box: parsing it produces confident nonsense.
  const file = faststart(H264_AAC());
  const halfMoov = file.subarray(0, 40);
  assert.equal(assessRendition(halfMoov).playable, false);
});

// ---------------------------------------------------------------------------
// The parser cannot be made to loop or read out of bounds
// ---------------------------------------------------------------------------

test("a malformed box size terminates the walk", () => {
  for (const size of [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 7], [0xff, 0xff, 0xff, 0xff]]) {
    const hostile = raw(size, "moov", zeros(64));
    // A verdict, not a hang and not a crash.
    const verdict = assessRendition(hostile);
    assert.equal(verdict.playable, false);
  }
});

test("a 64-bit box size is refused rather than truncated", () => {
  // Silently taking the low word would mis-walk the whole file.
  const huge = raw([0, 0, 0, 1], "moov", [0, 0, 0, 1], [0, 0, 0, 0], zeros(64));
  assert.equal(assessRendition(huge).playable, false);
});

test("the moov fourcc appearing inside media data is not mistaken for an index", () => {
  // "moov" as four bytes of video. Without the mvhd check this would parse.
  const file = raw(ftyp(), box("mdat", raw("moov", zeros(64))), moov(...H264_AAC()));
  const head = file.subarray(0, 40);
  const tailWithDecoy = file.subarray(40, 140);

  const verdict = assessRendition(head, tailWithDecoy);
  assert.equal(verdict.playable, false, "a decoy fourcc was parsed as an index");
});

test("a child box that runs past its parent is malformed, not clamped", () => {
  // Clamping is how a parser ends up reading one box's length and another box's
  // contents. Inside a box that declared its own length there is no such thing
  // as "a bit more than it said".
  const oversized = raw([0, 0, 0x10, 0x00], "avcC", zeros(8)); // 4 KiB inside 16 bytes
  const entry = box("avc1", zeros(78), oversized);
  const stsd = box("stsd", zeros(4), raw([0, 0, 0, 1]), entry);
  const trakBox = box(
    "trak",
    box("mdia", box("hdlr", zeros(8), raw("vide"), zeros(12)), box("minf", box("stbl", stsd))),
  );
  const verdict = assessRendition(faststart([trakBox]));
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "file_malformed");
});

test("an avcC whose SPS length exceeds the box is malformed", () => {
  // The classic length-field attack: a declared length larger than the buffer.
  const verdict = assessRendition(
    faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ lyingSpsLength: 0xffff })))]),
  );
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "file_malformed");
});

test("an esds length prefix that never terminates is refused", () => {
  // The expandable length is up to four bytes, each with a continuation bit. A
  // fifth is malformed, and reading it is how a parser walks off the end.
  const runaway = box("esds", zeros(4), raw([0x03, 0x80, 0x80, 0x80, 0x80, 0x80], zeros(8)));
  const verdict = assessRendition(
    faststart([trak("soun", "mp4a", audioEntry("mp4a", runaway))]),
  );
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "file_malformed");
});

test("a legal multi-byte esds length is still read correctly", () => {
  // The counterpart risk: refusing the runaway must not mean refusing the form.
  const verdict = assessRendition(
    faststart([
      trak("vide", "avc1"),
      trak("soun", "mp4a", audioEntry("mp4a", esds({ lengthBytes: 4 }))),
    ]),
  );
  assert.equal(verdict.playable, true);
});

test("an illegal NAL length size is refused", () => {
  // 2 is not a value the specification defines. A parser that shrugs at it is a
  // parser that will shrug at the next impossible field too.
  const verdict = assessRendition(
    faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ lengthSizeMinusOne: 2 })))]),
  );
  assert.equal(verdict.reason, "file_malformed");

  const wrongVersion = assessRendition(
    faststart([trak("vide", "avc1", visualEntry("avc1", avcC({ version: 2 })))]),
  );
  assert.equal(wrongVersion.reason, "file_malformed");
});

test("nesting deeper than the ceiling is refused rather than followed", () => {
  // A hand-rolled bomb: boxes inside boxes, far past anything a recorder writes.
  let inner = box("stbl", box("stsd", zeros(4), raw([0, 0, 0, 0])));
  for (let depth = 0; depth < MAX_BOX_DEPTH + 4; depth += 1) inner = box("minf", inner);

  const deep = box(
    "trak",
    box("mdia", box("hdlr", zeros(8), raw("vide"), zeros(12)), inner),
  );
  const verdict = assessRendition(faststart([deep]));
  // A verdict, and never a playable one — whether it runs out of depth or simply
  // fails to find a track down there.
  assert.equal(verdict.playable, false);
});

test("a file made of thousands of boxes is refused rather than walked", () => {
  const many: Uint8Array[] = [];
  for (let index = 0; index < 5_000; index += 1) many.push(box("free", zeros(0)));
  const bomb = box("moov", box("mvhd", zeros(96)), ...many, ...H264_AAC());

  const started = Date.now();
  const verdict = assessRendition(raw(ftyp(), bomb, box("mdat", zeros(64))));
  // The point is that it returns at all, and quickly.
  assert.ok(Date.now() - started < 2_000, "the box budget did not bound the walk");
  assert.equal(verdict.playable, false);
  assert.equal(verdict.reason, "probe_limit_exceeded");
});

test("a moov claiming to be enormous is not walked into", () => {
  // `mdat` is never walked into, so only a container box's size matters here.
  const huge = raw([0x00, 0xff, 0xff, 0xff], "moov", zeros(256));
  const verdict = assessRendition(raw(ftyp(), huge));
  assert.equal(verdict.playable, false);
});

test("readFileType returns null rather than throwing on rubbish", () => {
  assert.equal(readFileType(new Uint8Array(4)), null);
  assert.equal(readFileType(raw("RIFF", zeros(16))), null);
});

test("locateMoov refuses a box it cannot fully see", () => {
  const file = faststart(H264_AAC());
  assert.equal(locateMoov(file.subarray(0, 30), null), null);
  assert.ok(locateMoov(file, null) !== null);
});

// ---------------------------------------------------------------------------
// What is said, and to whom
// ---------------------------------------------------------------------------

test("every reason has a staff explanation, and none of them leaks a codec", () => {
  const reasons: RenditionReason[] = [
    "ok", "container_matroska", "container_unrecognised", "container_brand_unsupported",
    "video_codec_unsupported", "audio_codec_unsupported", "video_profile_unsupported",
    "audio_profile_unsupported", "audio_format_unsupported", "codec_config_missing",
    "codec_config_conflict", "track_encrypted", "no_playable_track",
    "index_not_found", "file_malformed", "probe_limit_exceeded", "file_corrupt",
    "file_missing", "probe_timeout", "probe_unavailable",
    "object_identity_unavailable", "object_changed",
  ];

  for (const reason of reasons) {
    const message = staffExplanation(reason);
    assert.ok(message.length > 0, reason);
    // A pastor needs to know whether to re-record, wait, or call someone. A
    // fourcc, a brand, a bucket or a path helps none of those.
    for (const leak of [
      "avc1", "hvc1", "mp4a", "isom", "matroska", "mkv", "moov", "ftyp",
      "codec", "bucket", "supabase", "relay/", "storage_path",
      // The hardening pass added a great deal more that must not surface.
      "avcC", "esds", "profile", "level", "baseline", "high", "aac", "h.264",
      "chroma", "bit depth", "etag", "sha", "hash", "kHz", "channel",
    ]) {
      assert.ok(
        !message.toLowerCase().includes(leak.toLowerCase()),
        `"${reason}" leaks ${leak}`,
      );
    }
  }
});

test("only a probe failure is worth retrying", () => {
  for (const transient of [
    "probe_unavailable", "probe_timeout",
    // The object is different now. The next probe says what it is — which makes
    // this worth retrying and, importantly, *not* a statement about encoding.
    "object_changed", "object_identity_unavailable",
  ] as RenditionReason[]) {
    assert.equal(isTransientRefusal(transient), true, transient);
  }

  for (const permanent of [
    "container_matroska", "video_codec_unsupported", "audio_codec_unsupported",
    "container_brand_unsupported", "no_playable_track", "video_profile_unsupported",
    "audio_profile_unsupported", "audio_format_unsupported", "track_encrypted",
    "codec_config_missing", "codec_config_conflict", "file_malformed",
    "probe_limit_exceeded",
  ] as RenditionReason[]) {
    // A codec does not change on its own; retrying is a waste.
    assert.equal(isTransientRefusal(permanent), false, permanent);
  }
});

test("the portable sets are exactly what the documentation claims", () => {
  assert.deepEqual([...PORTABLE_VIDEO_CODECS].sort(), ["avc1", "avc3"]);
  assert.deepEqual([...PORTABLE_AUDIO_CODECS].sort(), ["mp4a"]);
  assert.ok(!PORTABLE_BRANDS.has("qt  "));
  assert.ok(PORTABLE_BRANDS.has("isom"));
});
