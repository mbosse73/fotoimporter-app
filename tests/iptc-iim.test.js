"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  encodeDataSet,
  truncateUtf8,
  buildIptcIimBlock,
  parseIptcIimData,
  MAX_KEYWORD_BYTES,
  MAX_CAPTION_BYTES,
} = require("../iptc-iim.js");

test("encodeDataSet schreibt den IIM-Kopf mit big-endian Länge", () => {
  const block = encodeDataSet(2, 0x19, new Uint8Array([0x41, 0x42]));
  assert.deepStrictEqual(Array.from(block), [0x1c, 2, 0x19, 0x00, 0x02, 0x41, 0x42]);
});

test("encodeDataSet lehnt Daten jenseits der einfachen Längenkodierung ab", () => {
  assert.throws(() => encodeDataSet(2, 0x19, new Uint8Array(0x8000)));
});

test("truncateUtf8 lässt kurze Zeichenketten unverändert", () => {
  assert.strictEqual(new TextDecoder().decode(truncateUtf8("kurz", 64)), "kurz");
});

test("truncateUtf8 zerschneidet keinen Mehrbyte-Codepoint", () => {
  // "ä" ist 2 Bytes: bei maxBytes=1 darf nichts übrig bleiben, nicht ein halbes Zeichen.
  assert.strictEqual(truncateUtf8("ä", 1).length, 0);
  assert.strictEqual(new TextDecoder().decode(truncateUtf8("aä", 2)), "a");
  assert.strictEqual(new TextDecoder().decode(truncateUtf8("aä", 3)), "aä");
});

test("truncateUtf8 schneidet exakt an der Grenze, wenn sie auf eine Zeichengrenze fällt", () => {
  assert.strictEqual(new TextDecoder().decode(truncateUtf8("abcdef", 3)), "abc");
});

test("truncateUtf8 verkraftet Zeichen jenseits der BMP (4 Byte)", () => {
  const emoji = "\u{1F600}"; // 4 Bytes in UTF-8
  assert.strictEqual(truncateUtf8(emoji, 3).length, 0);
  assert.strictEqual(new TextDecoder().decode(truncateUtf8(emoji, 4)), emoji);
});

test("Stichworte laufen unverändert durch den Round-Trip", () => {
  const block = buildIptcIimBlock(["Berg", "Schnee", "Öl"], null);
  const parsed = parseIptcIimData(block);
  assert.deepStrictEqual(parsed.keywords, ["Berg", "Schnee", "Öl"]);
  assert.strictEqual(parsed.description, null);
});

test("Beschreibung läuft unverändert durch den Round-Trip", () => {
  const block = buildIptcIimBlock(["a"], "Eine Beschreibung mit Umlauten: Öl & Straße");
  const parsed = parseIptcIimData(block);
  assert.strictEqual(parsed.description, "Eine Beschreibung mit Umlauten: Öl & Straße");
});

test("leere und reine Leerraum-Stichworte werden übersprungen", () => {
  const block = buildIptcIimBlock(["", "   ", "gut"], null);
  assert.deepStrictEqual(parseIptcIimData(block).keywords, ["gut"]);
});

test("Stichworte werden getrimmt", () => {
  assert.deepStrictEqual(parseIptcIimData(buildIptcIimBlock(["  Rand  "], null)).keywords, ["Rand"]);
});

test("überlange Stichworte werden auf die Spezifikationsgrenze gekürzt", () => {
  // Regression zu Befund M3: die Kürzung ist korrekt, die PRÜFUNG dagegen muss
  // denselben gekürzten Wert erwarten - sonst scheitert der Verschiebevorgang.
  const lang = "A".repeat(MAX_KEYWORD_BYTES + 20);
  const parsed = parseIptcIimData(buildIptcIimBlock([lang], null));
  assert.strictEqual(parsed.keywords.length, 1);
  assert.strictEqual(parsed.keywords[0].length, MAX_KEYWORD_BYTES);
  assert.strictEqual(parsed.keywords[0], lang.slice(0, MAX_KEYWORD_BYTES));
});

test("überlange Beschreibungen werden auf die Spezifikationsgrenze gekürzt", () => {
  const lang = "B".repeat(MAX_CAPTION_BYTES + 50);
  const parsed = parseIptcIimData(buildIptcIimBlock([], lang));
  assert.strictEqual(parsed.description.length, MAX_CAPTION_BYTES);
});

test("das Pflicht-DataSet Record Version steht am Anfang", () => {
  const block = buildIptcIimBlock(["x"], null);
  assert.deepStrictEqual(Array.from(block.slice(0, 7)), [0x1c, 2, 0x00, 0x00, 0x02, 0x00, 0x04]);
});

test("ein Block ganz ohne Stichworte enthält trotzdem die Record Version", () => {
  const parsed = parseIptcIimData(buildIptcIimBlock([], null));
  assert.deepStrictEqual(parsed.keywords, []);
  assert.strictEqual(parsed.description, null);
});

test("parseIptcIimData bricht bei abgeschnittenen Daten ab, statt zu werfen", () => {
  const block = buildIptcIimBlock(["Berg", "Schnee"], null);
  const parsed = parseIptcIimData(block.slice(0, block.length - 3));
  assert.ok(Array.isArray(parsed.keywords));
  assert.ok(parsed.keywords.length < 2, "unvollständiges DataSet darf nicht als vollständig gelten");
});

test("parseIptcIimData ignoriert fremde Bytes hinter dem Block", () => {
  const block = buildIptcIimBlock(["Berg"], null);
  const mitMuell = new Uint8Array(block.length + 4);
  mitMuell.set(block, 0);
  mitMuell.set([0xaa, 0xbb, 0xcc, 0xdd], block.length);
  assert.deepStrictEqual(parseIptcIimData(mitMuell).keywords, ["Berg"]);
});
