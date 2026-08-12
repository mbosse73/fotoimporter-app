/**
 * Tests für raw-preview.js – das Auffinden eingebetteter Vorschau-JPEGs in
 * RAW-Dateien.
 *
 * Die Testdateien sind synthetische TIFF- und RAF-Strukturen. Eine echte
 * Kameradatei wäre 30 MB groß und würde bei einem Fehlschlag nur sagen "geht
 * nicht", nicht "der Offset im SubIFD wird falsch gelesen".
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { concat, ascii } = require("./helpers.js");
const {
  findEmbeddedJpegRanges,
  scanForJpegRanges,
  readTiffHeader,
  dedupeAndSortRanges,
  MIN_EMBEDDED_JPEG_BYTES,
} = require("../raw-preview.js");

/* ---- Bausteine ---- */

function u16(value, littleEndian) {
  return littleEndian
    ? new Uint8Array([value & 0xff, (value >> 8) & 0xff])
    : new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function u32(value, littleEndian) {
  return littleEndian
    ? new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff])
    : new Uint8Array([(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

/** Ein IFD-Eintrag: Tag, Typ, Anzahl, Wert (immer als LONG mit einem Wert). */
function ifdEntry(tag, value, littleEndian, type = 4, count = 1) {
  return concat([u16(tag, littleEndian), u16(type, littleEndian), u32(count, littleEndian), u32(value, littleEndian)]);
}

/**
 * Baut eine TIFF-artige Datei mit einem IFD an fester Stelle (Offset 8) und
 * einem "JPEG" an einer wählbaren Position.
 */
function buildTiff({ littleEndian = true, entries = [], magic = 42, jpegAt = 512, jpegLength = 4096, totalSize = 8192, nextIfd = 0 } = {}) {
  const header = concat([
    ascii(littleEndian ? "II" : "MM"),
    u16(magic, littleEndian),
    u32(8, littleEndian), // erstes IFD direkt hinter dem Kopf
  ]);
  const ifd = concat([
    u16(entries.length, littleEndian),
    ...entries,
    u32(nextIfd, littleEndian),
  ]);

  const bytes = new Uint8Array(totalSize);
  bytes.set(header, 0);
  bytes.set(ifd, 8);
  // Ein Bereich, der wie ein JPEG beginnt und endet.
  if (jpegAt + jpegLength <= totalSize) {
    bytes.set([0xff, 0xd8, 0xff, 0xe0], jpegAt);
    bytes.set([0xff, 0xd9], jpegAt + jpegLength - 2);
  }
  return bytes;
}

/* ---- TIFF-Kopf ---- */

test("readTiffHeader erkennt beide Byte-Reihenfolgen", () => {
  const klein = readTiffHeader(buildTiff({ littleEndian: true }));
  assert.deepStrictEqual(klein, { littleEndian: true, firstIfdOffset: 8 });

  const gross = readTiffHeader(buildTiff({ littleEndian: false }));
  assert.deepStrictEqual(gross, { littleEndian: false, firstIfdOffset: 8 });
});

test("readTiffHeader akzeptiert die Hersteller-Magics von ORF und RW2", () => {
  assert.ok(readTiffHeader(buildTiff({ magic: 0x4f52 })), "ORF (RO)");
  assert.ok(readTiffHeader(buildTiff({ magic: 0x5352 })), "ORF (RS)");
  assert.ok(readTiffHeader(buildTiff({ magic: 0x55 })), "RW2");
});

test("readTiffHeader weist alles zurück, was kein TIFF ist", () => {
  assert.strictEqual(readTiffHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), null);
  assert.strictEqual(readTiffHeader(new Uint8Array([0x49, 0x49, 0x00, 0x00, 0, 0, 0, 0])), null, "falsche Magic");
  assert.strictEqual(readTiffHeader(new Uint8Array([0x49])), null, "zu kurz");
});

/* ---- JpegInterchangeFormat (NEF, ARW, DNG, SRW) ---- */

test("findet die Vorschau über JpegInterchangeFormat", () => {
  const bytes = buildTiff({
    entries: [
      ifdEntry(0x0201, 512, true), // JpegInterchangeFormat
      ifdEntry(0x0202, 4096, true), // JpegInterchangeFormatLength
    ],
  });
  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].offset, 512);
  assert.strictEqual(ranges[0].length, 4096);
  assert.strictEqual(ranges[0].source, "jpeg-interchange");
});

test("ein Offset ohne Längenangabe wird nicht verwendet", () => {
  // Ohne Länge lässt sich kein Bereich schneiden - raten wäre schlechter als nichts.
  const bytes = buildTiff({ entries: [ifdEntry(0x0201, 512, true)] });
  assert.deepStrictEqual(findEmbeddedJpegRanges(bytes, bytes.length), []);
});

test("funktioniert auch mit big-endian (MM)", () => {
  const bytes = buildTiff({
    littleEndian: false,
    entries: [ifdEntry(0x0201, 512, false), ifdEntry(0x0202, 4096, false)],
  });
  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].offset, 512);
});

/* ---- Einzelner JPEG-Streifen (CR2, ORF) ---- */

test("findet die Vorschau über einen einzelnen JPEG-Streifen", () => {
  const bytes = buildTiff({
    entries: [
      ifdEntry(0x0103, 6, true), // Compression = JPEG
      ifdEntry(0x0111, 1024, true), // StripOffsets
      ifdEntry(0x0117, 2048, true), // StripByteCounts
    ],
    jpegAt: 1024,
    jpegLength: 2048,
  });
  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].source, "strip");
  assert.strictEqual(ranges[0].offset, 1024);
});

test("ein Streifen ohne JPEG-Kompression wird übergangen", () => {
  // Compression 1 = unkomprimiert: das sind Bilddaten, kein schneidbares JPEG.
  const bytes = buildTiff({
    entries: [ifdEntry(0x0103, 1, true), ifdEntry(0x0111, 1024, true), ifdEntry(0x0117, 2048, true)],
  });
  assert.deepStrictEqual(findEmbeddedJpegRanges(bytes, bytes.length), []);
});

/* ---- Unter-IFDs (NEF, DNG) ---- */

test("folgt SubIFD-Verweisen", () => {
  // Die große Vorschau liegt bei NEF und DNG typischerweise in einem SubIFD,
  // nicht im ersten IFD.
  const littleEndian = true;
  const subIfdOffset = 200;
  const bytes = buildTiff({ entries: [ifdEntry(0x014a, subIfdOffset, littleEndian)] });

  const subIfd = concat([
    u16(2, littleEndian),
    ifdEntry(0x0201, 1024, littleEndian),
    ifdEntry(0x0202, 3000, littleEndian),
    u32(0, littleEndian),
  ]);
  bytes.set(subIfd, subIfdOffset);

  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].offset, 1024);
});

test("folgt der IFD-Kette über den next-Zeiger", () => {
  const littleEndian = true;
  const zweitesIfd = 300;
  const bytes = buildTiff({ entries: [ifdEntry(0x0103, 1, littleEndian)], nextIfd: zweitesIfd });

  const ifd1 = concat([
    u16(2, littleEndian),
    ifdEntry(0x0201, 2048, littleEndian),
    ifdEntry(0x0202, 1500, littleEndian),
    u32(0, littleEndian),
  ]);
  bytes.set(ifd1, zweitesIfd);

  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].offset, 2048);
});

test("ein zyklischer IFD-Verweis führt nicht zur Endlosschleife", () => {
  // Eine defekte Datei darf das Einlesen des Ordners nicht aufhängen.
  const littleEndian = true;
  const bytes = buildTiff({ entries: [ifdEntry(0x0103, 1, littleEndian)], nextIfd: 8 });
  assert.deepStrictEqual(findEmbeddedJpegRanges(bytes, bytes.length), []);
});

/* ---- Mehrere Kandidaten ---- */

test("mehrere Kandidaten werden nach Größe sortiert, größter zuerst", () => {
  // Die kleinen Bereiche sind Miniaturbilder, der große ist die Bildschirmvorschau.
  const littleEndian = true;
  const subIfdOffset = 200;
  const bytes = buildTiff({
    entries: [
      ifdEntry(0x0201, 1024, littleEndian),
      ifdEntry(0x0202, 2000, littleEndian),
      ifdEntry(0x014a, subIfdOffset, littleEndian),
    ],
  });
  bytes.set(concat([
    u16(2, littleEndian),
    ifdEntry(0x0201, 4096, littleEndian),
    ifdEntry(0x0202, 4000, littleEndian),
    u32(0, littleEndian),
  ]), subIfdOffset);

  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.deepStrictEqual(ranges.map((r) => r.length), [4000, 2000]);
});

/* ---- Panasonic RW2 ---- */

test("findet die Vorschau im Panasonic-Feld JpegFromRaw", () => {
  // Bei RW2 IST der Feldwert das JPEG; die Anzahl ist gleichzeitig die Länge.
  const littleEndian = true;
  const bytes = buildTiff({
    magic: 0x55,
    entries: [ifdEntry(0x002e, 1024, littleEndian, 7, 3000)],
    jpegAt: 1024,
    jpegLength: 3000,
  });
  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].source, "panasonic");
  assert.strictEqual(ranges[0].length, 3000);
});

/* ---- Fujifilm RAF ---- */

test("findet die Vorschau im RAF-Kopf", () => {
  const bytes = new Uint8Array(8192);
  bytes.set(ascii("FUJIFILMCCD-RAW"), 0);
  bytes.set(u32(2048, false), 84); // Offset, big-endian
  bytes.set(u32(3000, false), 88); // Länge, big-endian

  const ranges = findEmbeddedJpegRanges(bytes, bytes.length);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].source, "raf");
  assert.strictEqual(ranges[0].offset, 2048);
  assert.strictEqual(ranges[0].length, 3000);
});

test("ein RAF ohne Vorschauangabe liefert nichts", () => {
  const bytes = new Uint8Array(8192);
  bytes.set(ascii("FUJIFILMCCD-RAW"), 0);
  assert.deepStrictEqual(findEmbeddedJpegRanges(bytes, bytes.length), []);
});

/* ---- Plausibilitätsprüfung ---- */

test("Bereiche außerhalb der Datei werden verworfen", () => {
  // Der gefährliche Fall: ein defekter Offset, aus dem ein sinnloser Blob würde.
  const bytes = buildTiff({
    entries: [ifdEntry(0x0201, 7000, true), ifdEntry(0x0202, 5000, true)],
  });
  assert.deepStrictEqual(findEmbeddedJpegRanges(bytes, 8192), []);
});

test("zu kleine Bereiche werden verworfen", () => {
  const zuKlein = MIN_EMBEDDED_JPEG_BYTES - 1;
  const bytes = buildTiff({ entries: [ifdEntry(0x0201, 512, true), ifdEntry(0x0202, zuKlein, true)] });
  assert.deepStrictEqual(findEmbeddedJpegRanges(bytes, bytes.length), []);
});

test("dedupeAndSortRanges entfernt Dubletten", () => {
  // Derselbe Bereich taucht regelmäßig doppelt auf (SubIFD und IFD-Kette).
  const ranges = dedupeAndSortRanges([
    { offset: 100, length: 5000 },
    { offset: 100, length: 5000 },
    { offset: 200, length: 9000 },
  ], 100000);
  assert.deepStrictEqual(ranges.map((r) => r.length), [9000, 5000]);
});

test("eine Datei, die weder TIFF noch RAF ist, liefert nichts", () => {
  assert.deepStrictEqual(findEmbeddedJpegRanges(new Uint8Array(2048), 2048), []);
  assert.deepStrictEqual(findEmbeddedJpegRanges(new Uint8Array([1, 2, 3]), 3), []);
});

/* ---- Byte-Suche als Rückfallweg ---- */

test("scanForJpegRanges findet ein vollständiges JPEG", () => {
  const jpeg = new Uint8Array(3000);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
  jpeg.set([0xff, 0xd9], 2998);

  const datei = new Uint8Array(9000);
  datei.set(jpeg, 4000);

  const ranges = scanForJpegRanges(datei, 0);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(ranges[0].offset, 4000);
  assert.strictEqual(ranges[0].length, 3000);
});

test("scanForJpegRanges rechnet den Basis-Offset ein", () => {
  const bytes = new Uint8Array(3000);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], 2998);

  const ranges = scanForJpegRanges(bytes, 1000);
  assert.strictEqual(ranges[0].offset, 1000);
});

test("scanForJpegRanges liefert nichts ohne Endmarke", () => {
  // Ein abgeschnittenes Bild ist kein Kandidat: der Blob wäre unvollständig.
  const bytes = new Uint8Array(3000);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  assert.deepStrictEqual(scanForJpegRanges(bytes, 0), []);
});

test("scanForJpegRanges findet mehrere Bilder und sortiert nach Größe", () => {
  const datei = new Uint8Array(20000);
  datei.set([0xff, 0xd8, 0xff, 0xe0], 0);
  datei.set([0xff, 0xd9], 1998); // 2000 Byte
  datei.set([0xff, 0xd8, 0xff, 0xe0], 5000);
  datei.set([0xff, 0xd9], 12998); // 8000 Byte

  const ranges = scanForJpegRanges(datei, 0);
  assert.deepStrictEqual(ranges.map((r) => r.length), [8000, 2000]);
});
