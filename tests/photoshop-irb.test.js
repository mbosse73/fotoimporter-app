"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildIrbForIptc, parseIrbs, padToEvenLength, IRB_RESOURCE_ID_IPTC } = require("../photoshop-irb.js");
const { concat, ascii, bytesEqual } = require("./helpers.js");

test("padToEvenLength lässt gerade Längen unverändert", () => {
  const even = new Uint8Array([1, 2]);
  assert.strictEqual(padToEvenLength(even), even);
});

test("padToEvenLength hängt genau ein Nullbyte an ungerade Längen", () => {
  assert.deepStrictEqual(Array.from(padToEvenLength(new Uint8Array([1, 2, 3]))), [1, 2, 3, 0]);
});

test("ein gebautes IRB lässt sich zurücklesen", () => {
  const daten = new Uint8Array([1, 2, 3, 4]);
  const parsed = parseIrbs(buildIrbForIptc(daten));
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].resourceId, IRB_RESOURCE_ID_IPTC);
  assert.ok(bytesEqual(parsed[0].data, daten));
});

test("die Größenangabe meint die UNGEPOLSTERTE Länge, der Block endet aber gerade", () => {
  // Diese Unterscheidung ist die klassische Fehlerquelle bei IRBs: wer die
  // gepolsterte Länge einträgt, hängt beim Zurücklesen ein Nullbyte an die Daten.
  const ungerade = new Uint8Array([1, 2, 3]);
  const irb = buildIrbForIptc(ungerade);
  const parsed = parseIrbs(irb);
  assert.strictEqual(parsed[0].data.length, 3, "Daten dürfen das Füllbyte nicht enthalten");
  assert.strictEqual(irb.length % 2, 0, "der Block selbst muss auf gerader Länge enden");
  assert.strictEqual(parsed[0].end, irb.length);
});

test("mehrere hintereinanderliegende IRBs werden alle gefunden", () => {
  const a = buildIrbForIptc(new Uint8Array([1]));
  const b = buildIrbForIptc(new Uint8Array([2, 2]));
  const c = buildIrbForIptc(new Uint8Array([3, 3, 3]));
  const parsed = parseIrbs(concat([a, b, c]));
  assert.strictEqual(parsed.length, 3);
  assert.deepStrictEqual(parsed.map((p) => p.data.length), [1, 2, 3]);
});

test("die gemeldeten Byte-Bereiche erlauben gezieltes Ersetzen", () => {
  // app.js/jpeg-segments.js schneidet über start/end genau die Blöcke heraus,
  // die erhalten bleiben sollen - die Grenzen müssen deshalb exakt aneinanderstoßen.
  const a = buildIrbForIptc(new Uint8Array([1]));
  const b = buildIrbForIptc(new Uint8Array([2, 2]));
  const kette = concat([a, b]);
  const parsed = parseIrbs(kette);
  assert.strictEqual(parsed[0].start, 0);
  assert.strictEqual(parsed[0].end, parsed[1].start);
  assert.strictEqual(parsed[1].end, kette.length);
  assert.ok(bytesEqual(kette.slice(parsed[0].start, parsed[0].end), a));
});

test("Daten ohne 8BIM-Signatur liefern eine leere Liste statt eines Fehlers", () => {
  assert.deepStrictEqual(parseIrbs(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), []);
});

test("ein leerer Puffer liefert eine leere Liste", () => {
  assert.deepStrictEqual(parseIrbs(new Uint8Array(0)), []);
});

test("ein abgeschnittener Block wird verworfen statt teilweise gelesen", () => {
  const irb = buildIrbForIptc(new Uint8Array([1, 2, 3, 4, 5, 6]));
  assert.deepStrictEqual(parseIrbs(irb.slice(0, irb.length - 2)), []);
});

test("eine unsinnig große Längenangabe führt nicht zu negativen Bereichen", () => {
  // Regression zu Befund G6: ohne >>> 0 wäre die Größe negativ und dataEnd läge
  // vor dataStart - parseIrbs hätte dann stillschweigend einen leeren Block gemeldet.
  const kaputt = concat([
    ascii("8BIM"),
    new Uint8Array([0x04, 0x04]),       // Resource-ID
    new Uint8Array([0x00, 0x00]),       // leerer Pascal-Name
    new Uint8Array([0xff, 0xff, 0xff, 0xff]), // Größe mit gesetztem obersten Bit
    new Uint8Array([1, 2, 3, 4]),
  ]);
  const parsed = parseIrbs(kaputt);
  assert.deepStrictEqual(parsed, [], "der Block liegt nicht im Puffer und muss verworfen werden");
});
