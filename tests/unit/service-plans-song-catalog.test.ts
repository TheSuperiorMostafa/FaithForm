import assert from "node:assert/strict";
import test from "node:test";

import { catalogFacts, catalogQuery, matchLibrarySong, songSelectUrl } from "@/lib/service-plans/songs/catalog";
import { ccliSongNumberFromLine, parseChordPro, parseSongFile } from "@/lib/service-plans/songs/parsers";

// Invented placeholder songs and numbers only. These fixtures cover the shapes
// we guess a SongSelect ChordPro download might use; they have NOT been
// checked against real SongSelect files.

const BODY = ["{start_of_verse: Verse 1}", "[G]Morning light is [C]on the hill", "{end_of_verse}"].join("\n");

const FIXTURES: { name: string; text: string; ccli: string | null }[] = [
  { name: "{ccli: N}", text: `{title: Morning Light}\n{ccli: 1234567}\n${BODY}`, ccli: "1234567" },
  { name: "{ccli_number: N}", text: `{title: Morning Light}\n{ccli_number: 7654321}\n${BODY}`, ccli: "7654321" },
  { name: "{meta: ccli N}", text: `{title: Morning Light}\n{meta: ccli 2222222}\n${BODY}`, ccli: "2222222" },
  { name: "{meta: ccli: N}", text: `{title: Morning Light}\n{meta: ccli: 3333333}\n${BODY}`, ccli: "3333333" },
  { name: "{meta: ccli_number N}", text: `{title: Morning Light}\n{meta: ccli_number 4444444}\n${BODY}`, ccli: "4444444" },
  { name: "# CCLI Song # N comment", text: `# CCLI Song # 5555555\n{title: Morning Light}\n${BODY}`, ccli: "5555555" },
  { name: "#CCLI Song #N comment", text: `#CCLI Song #5555556\n{title: Morning Light}\n${BODY}`, ccli: "5555556" },
  { name: "{comment: CCLI Song # N}", text: `{title: Morning Light}\n{comment: CCLI Song # 6666666}\n${BODY}`, ccli: "6666666" },
  {
    name: "footer lines in the body, with the church's licence number",
    text: `{title: Morning Light}\n${BODY}\n\nCCLI Song #7777777\n© 2020 Example Music\nCCLI License # 999999`,
    ccli: "7777777",
  },
  { name: "{x_ccli: N}", text: `{title: Morning Light}\n{x_ccli: 8888888}\n${BODY}`, ccli: "8888888" },
  { name: "licence number only", text: `{title: Morning Light}\n{ccli_license: 999999}\n# CCLI License # 999999\n${BODY}`, ccli: null },
];

for (const fixture of FIXTURES) {
  test(`ChordPro CCLI number: ${fixture.name}`, () => {
    const song = parseChordPro(fixture.text, "morning-light.chordpro");
    assert.equal(song.ccliNumber, fixture.ccli);
    assert.equal(song.title, "Morning Light");
    // Footer and comment lines never end up in the words.
    assert.doesNotMatch(song.lyrics ?? "", /CCLI/i);
    assert.doesNotMatch(song.chartText ?? "", /CCLI/i);
    assert.match(song.chartText ?? "", /\[G\]Morning light/);
    assert.doesNotMatch(song.chartText ?? "", /©/);
  });
}

test("a footer copyright line becomes the copyright", () => {
  const song = parseChordPro(`{title: Morning Light}\n${BODY}\n© 2020 Example Music\nCCLI Song # 1234567`);
  assert.equal(song.copyright, "2020 Example Music");
  assert.equal(song.ccliNumber, "1234567");
});

test("a SongSelect-style .chordpro file is read as ChordPro", () => {
  const result = parseSongFile("Morning Light.chordpro", `{title: Morning Light}\n{ccli: 1234567}\n${BODY}`);
  assert.equal(result.format, "chordpro");
  assert.equal(result.songs[0].ccliNumber, "1234567");
});

test("CCLI song lines, never the licence", () => {
  assert.equal(ccliSongNumberFromLine("CCLI Song # 1234567"), "1234567");
  assert.equal(ccliSongNumberFromLine("CCLI Song #1234567"), "1234567");
  assert.equal(ccliSongNumberFromLine("CCLI Song No. 1234567"), "1234567");
  assert.equal(ccliSongNumberFromLine("CCLI Song Number: 1234567"), "1234567");
  assert.equal(ccliSongNumberFromLine("# CCLI Song # 1234567"), "1234567");
  assert.equal(ccliSongNumberFromLine("CCLI License # 1234567"), null);
  assert.equal(ccliSongNumberFromLine("Morning light is on the hill"), null);
});

test("matching a file to the library: CCLI number first, then title for confirmation", () => {
  const library = [
    { id: "a", title: "Morning Light", ccliNumber: "1234567" },
    { id: "b", title: "Lanterns (Live)", ccliNumber: null },
    { id: "c", title: "River Song", ccliNumber: "1111111" },
  ];
  assert.deepEqual(matchLibrarySong({ title: "Anything", ccliNumber: "1234567" }, library), {
    songId: "a",
    title: "Morning Light",
    reason: "ccli",
  });
  assert.deepEqual(matchLibrarySong({ title: "lanterns", ccliNumber: null }, library), {
    songId: "b",
    title: "Lanterns (Live)",
    reason: "title",
  });
  assert.deepEqual(matchLibrarySong({ title: "Lanterns", ccliNumber: "2222222" }, library)?.reason, "title");
  // Same title but a different CCLI number on both sides is a different song.
  assert.equal(matchLibrarySong({ title: "River Song", ccliNumber: "3333333" }, library), null);
  assert.equal(matchLibrarySong({ title: "Unknown", ccliNumber: null }, library), null);
});

test("catalog search reads CCLI numbers and title words", () => {
  assert.deepEqual(catalogQuery("1234567"), { ccli: "1234567", tsquery: null, text: "1234567" });
  assert.equal(catalogQuery("CCLI 1234567").ccli, "1234567");
  assert.equal(catalogQuery("CCLI Song # 1234567").ccli, "1234567");
  assert.equal(catalogQuery("#1234567").ccli, "1234567");
  assert.equal(catalogQuery("morning lig").tsquery, "morning:* & lig:*");
  // Full-text operators and quotes can't reach the query.
  assert.equal(catalogQuery("light & (dark) | !x:* 'y'").tsquery, "light:* & dark:* & x:* & y:*");
  assert.equal(catalogQuery("   ").tsquery, null);
  assert.equal(catalogQuery(42).text, "");
});

test("Get chart opens the exact song on SongSelect, only with a CCLI number", () => {
  assert.equal(songSelectUrl("1234567"), "https://songselect.ccli.com/songs/1234567");
  assert.equal(songSelectUrl(" 1234567 "), "https://songselect.ccli.com/songs/1234567");
  assert.equal(songSelectUrl(null), null);
  assert.equal(songSelectUrl("12a"), null);
  assert.equal(songSelectUrl("../x"), null);
});

test("catalog contributions carry facts only, and need a CCLI number", () => {
  const facts = catalogFacts({
    ccliNumber: "1234567",
    title: " Morning Light ",
    author: "A. Writer",
    copyright: "2020 Example Music",
    defaultKey: "G",
    tempo: 400,
    themes: ["Hope"],
    // Extra fields a caller might pass are not copied.
    ...({ lyrics: "Morning light is on the hill" } as object),
  });
  assert.deepEqual(facts, {
    ccli_number: "1234567",
    title: "Morning Light",
    author: "A. Writer",
    copyright: "2020 Example Music",
    default_key: "G",
    tempo: null,
    themes: ["Hope"],
    source: "church",
  });
  assert.equal(catalogFacts({ ccliNumber: null, title: "Morning Light" }), null);
  assert.equal(catalogFacts({ ccliNumber: "12345678901", title: "Morning Light" }), null);
});
