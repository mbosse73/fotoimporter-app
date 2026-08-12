"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  parseJpegSegments,
  buildApp13Segment,
  buildApp1XmpSegment,
  writeKeywordsToJpeg,
  PHOTOSHOP_PREAMBLE,
  XMP_PREAMBLE,
} = require("../jpeg-segments.js");
const { buildIptcIimBlock, parseIptcIimData } = require("../iptc-iim.js");
const { buildIrbForIptc, parseIrbs } = require("../photoshop-irb.js");
const { buildXmpPacket, parseXmpData } = require("../xmp-packet.js");
const { buildJpeg, buildExifApp1, jfifSegment, ascii, concat, bytesEqual } = require("./helpers.js");

const deps = { buildIptcIimBlock, buildIrbForIptc, parseIrbs, buildXmpPacket };

/** Liest die eingebetteten Metadaten aus einem geschriebenen JPEG zurück. */
function readEmbedded(buffer) {
  const { segments } = parseJpegSegments(buffer);
  let iptc = null;
  let xmp = null;
  for (const seg of segments) {
    if (seg.marker === 0xed) {
      const prefix = String.fromCharCode(...buffer.slice(seg.start + 4, seg.start + 4 + PHOTOSHOP_PREAMBLE.length));
      if (prefix !== PHOTOSHOP_PREAMBLE) continue;
      const irbs = parseIrbs(buffer.slice(seg.start + 4 + PHOTOSHOP_PREAMBLE.length, seg.end));
      for (const irb of irbs) if (irb.resourceId === 0x0404) iptc = parseIptcIimData(irb.data);
    } else if (seg.marker === 0xe1) {
      const prefix = String.fromCharCode(...buffer.slice(seg.start + 4, seg.start + 4 + XMP_PREAMBLE.length));
      if (prefix !== XMP_PREAMBLE) continue;
      xmp = parseXmpData(new TextDecoder().decode(buffer.slice(seg.start + 4 + XMP_PREAMBLE.length, seg.end)));
    }
  }
  return { iptc, xmp };
}

test("parseJpegSegments verlangt den SOI-Marker", () => {
  assert.throws(() => parseJpegSegments(new Uint8Array([0x00, 0x00, 0xff, 0xd8])), /SOI/);
});

test("parseJpegSegments findet alle Segmente bis zum Start-of-Scan", () => {
  const jpeg = buildJpeg([jfifSegment(), buildExifApp1("2020:01:02 03:04:05")]);
  const { segments, scanStart } = parseJpegSegments(jpeg);
  assert.deepStrictEqual(segments.map((s) => s.marker), [0xe0, 0xe1]);
  assert.strictEqual(jpeg[scanStart], 0xff);
  assert.strictEqual(jpeg[scanStart + 1], 0xda);
});

test("Segmentgrenzen stoßen lückenlos aneinander", () => {
  const jpeg = buildJpeg([jfifSegment(), buildExifApp1("2020:01:02 03:04:05")]);
  const { segments, scanStart } = parseJpegSegments(jpeg);
  assert.strictEqual(segments[0].start, 2);
  assert.strictEqual(segments[0].end, segments[1].start);
  assert.strictEqual(segments[1].end, scanStart);
});

test("ein JPEG ohne Start-of-Scan wird abgelehnt", () => {
  const ohneSos = concat([new Uint8Array([0xff, 0xd8]), jfifSegment()]);
  assert.throws(() => parseJpegSegments(ohneSos), /Start-of-Scan/);
});

test("buildApp13Segment lehnt zu große Nutzdaten ab", () => {
  assert.throws(() => buildApp13Segment(new Uint8Array(0xfff0)), /zu groß/);
});

test("buildApp1XmpSegment lehnt zu große Pakete ab", () => {
  assert.throws(() => buildApp1XmpSegment("x".repeat(0xfff0)), /zu groß/);
});

test("die Bilddaten ab Start-of-Scan bleiben byteidentisch", () => {
  // Das ist die wichtigste Zusicherung des ganzen Moduls: die Sicherheitsprüfung
  // in app.js vergleicht genau diesen Bereich per SHA-256, bevor sie die
  // Quelldatei löscht. Verschiebt sich hier ein Byte, gilt jedes Foto als beschädigt.
  const bilddaten = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
  const original = buildJpeg([jfifSegment(), buildExifApp1("2020:01:02 03:04:05")], bilddaten);
  const geschrieben = writeKeywordsToJpeg(original, ["Berg"], deps, "Text");

  const vorher = original.slice(parseJpegSegments(original).scanStart);
  const nachher = geschrieben.slice(parseJpegSegments(geschrieben).scanStart);
  assert.ok(bytesEqual(vorher, nachher));
});

test("IPTC und XMP werden beide geschrieben und lassen sich zurücklesen", () => {
  const jpeg = buildJpeg([jfifSegment()]);
  const { iptc, xmp } = readEmbedded(writeKeywordsToJpeg(jpeg, ["Berg", "Schnee"], deps, "Winter"));
  assert.deepStrictEqual(iptc.keywords, ["Berg", "Schnee"]);
  assert.deepStrictEqual(xmp.keywords, ["Berg", "Schnee"]);
  assert.strictEqual(iptc.description, "Winter");
  assert.strictEqual(xmp.description, "Winter");
});

test("ein bestehendes EXIF-Segment bleibt unangetastet", () => {
  const exif = buildExifApp1("2020:01:02 03:04:05");
  const jpeg = buildJpeg([jfifSegment(), exif]);
  const geschrieben = writeKeywordsToJpeg(jpeg, ["Berg"], deps, null);

  const { segments } = parseJpegSegments(geschrieben);
  const exifSegmente = segments.filter((s) => {
    if (s.marker !== 0xe1) return false;
    return String.fromCharCode(...geschrieben.slice(s.start + 4, s.start + 10)) === "Exif\0\0";
  });
  assert.strictEqual(exifSegmente.length, 1);
  const gefunden = geschrieben.slice(exifSegmente[0].start, exifSegmente[0].end);
  assert.ok(bytesEqual(gefunden, exif), "das EXIF-Segment muss byteidentisch übernommen werden");
});

test("ein bestehendes JFIF-Segment bleibt erhalten", () => {
  const jfif = jfifSegment();
  const geschrieben = writeKeywordsToJpeg(buildJpeg([jfif]), ["x"], deps, null);
  const { segments } = parseJpegSegments(geschrieben);
  const app0 = segments.filter((s) => s.marker === 0xe0);
  assert.strictEqual(app0.length, 1);
  assert.ok(bytesEqual(geschrieben.slice(app0[0].start, app0[0].end), jfif));
});

test("fremde Image Resource Blocks im APP13 bleiben erhalten", () => {
  // Ein bestehendes APP13 kann z.B. ein Photoshop-Thumbnail enthalten. Nur der
  // IPTC-Block (0x0404) darf ersetzt werden, alles andere muss überleben.
  const fremdesIrb = concat([
    ascii("8BIM"),
    new Uint8Array([0x04, 0x0c]), // Resource-ID 0x040c = Thumbnail
    new Uint8Array([0x00, 0x00]),
    new Uint8Array([0x00, 0x00, 0x00, 0x04]),
    new Uint8Array([9, 9, 9, 9]),
  ]);
  const altesIptc = buildIrbForIptc(buildIptcIimBlock(["alt"], null));
  const app13 = buildApp13Segment(concat([fremdesIrb, altesIptc]));

  const geschrieben = writeKeywordsToJpeg(buildJpeg([jfifSegment(), app13]), ["neu"], deps, null);
  const { segments } = parseJpegSegments(geschrieben);
  const app13Neu = segments.find((s) => s.marker === 0xed);
  const irbs = parseIrbs(geschrieben.slice(app13Neu.start + 4 + PHOTOSHOP_PREAMBLE.length, app13Neu.end));

  assert.ok(irbs.some((i) => i.resourceId === 0x040c), "das fremde IRB muss erhalten bleiben");
  const iptcIrbs = irbs.filter((i) => i.resourceId === 0x0404);
  assert.strictEqual(iptcIrbs.length, 1, "es darf genau ein IPTC-Block übrig bleiben");
  assert.deepStrictEqual(parseIptcIimData(iptcIrbs[0].data).keywords, ["neu"]);
});

test("ein bestehendes XMP-Segment wird ersetzt, nicht verdoppelt", () => {
  const altesXmp = buildApp1XmpSegment(buildXmpPacket(["alt"], null));
  const jpeg = buildJpeg([jfifSegment(), altesXmp]);
  const geschrieben = writeKeywordsToJpeg(jpeg, ["neu"], deps, null);

  const { segments } = parseJpegSegments(geschrieben);
  const xmpSegmente = segments.filter((s) => {
    if (s.marker !== 0xe1) return false;
    return String.fromCharCode(...geschrieben.slice(s.start + 4, s.start + 4 + XMP_PREAMBLE.length)) === XMP_PREAMBLE;
  });
  assert.strictEqual(xmpSegmente.length, 1, "es darf genau ein XMP-Segment geben");
  assert.deepStrictEqual(readEmbedded(geschrieben).xmp.keywords, ["neu"]);
});

test("ein bestehendes IPTC-APP13 wird ersetzt, nicht verdoppelt", () => {
  const app13 = buildApp13Segment(buildIrbForIptc(buildIptcIimBlock(["alt"], null)));
  const geschrieben = writeKeywordsToJpeg(buildJpeg([app13]), ["neu"], deps, null);
  const app13Segmente = parseJpegSegments(geschrieben).segments.filter((s) => s.marker === 0xed);
  assert.strictEqual(app13Segmente.length, 1);
  assert.deepStrictEqual(readEmbedded(geschrieben).iptc.keywords, ["neu"]);
});

test("mehrfaches Schreiben führt nicht zu wachsenden Dateien", () => {
  // Ohne korrektes Ersetzen würde jeder Durchgang ein weiteres APP13/APP1
  // anhängen - nach ein paar Durchläufen wäre die 64-KB-Grenze erreicht.
  const jpeg = buildJpeg([jfifSegment()]);
  const einmal = writeKeywordsToJpeg(jpeg, ["Berg"], deps, "Text");
  const zweimal = writeKeywordsToJpeg(einmal, ["Berg"], deps, "Text");
  const dreimal = writeKeywordsToJpeg(zweimal, ["Berg"], deps, "Text");
  assert.strictEqual(zweimal.length, dreimal.length);
  assert.ok(bytesEqual(zweimal, dreimal), "das Ergebnis muss ab dem zweiten Durchgang stabil sein");
});

test("ein JPEG ganz ohne Segmente vor dem Scan wird korrekt beschrieben", () => {
  const geschrieben = writeKeywordsToJpeg(buildJpeg([]), ["x"], deps, null);
  assert.deepStrictEqual(readEmbedded(geschrieben).iptc.keywords, ["x"]);
  assert.deepStrictEqual(readEmbedded(geschrieben).xmp.keywords, ["x"]);
});

test("das Ergebnis bleibt ein gültiges JPEG mit SOI und EOI", () => {
  const geschrieben = writeKeywordsToJpeg(buildJpeg([jfifSegment()]), ["x"], deps, null);
  assert.strictEqual(geschrieben[0], 0xff);
  assert.strictEqual(geschrieben[1], 0xd8);
  assert.strictEqual(geschrieben[geschrieben.length - 2], 0xff);
  assert.strictEqual(geschrieben[geschrieben.length - 1], 0xd9);
});

test("zu viele Stichworte lassen den Schreibvorgang scheitern statt zu beschädigen", () => {
  // Lieber ein Fehler (app.js fällt dann auf die Sidecar-Variante zurück) als ein
  // stillschweigend abgeschnittenes Segment.
  const vieleStichworte = Array.from({ length: 2000 }, (_, i) => "Stichwort" + i);
  assert.throws(() => writeKeywordsToJpeg(buildJpeg([jfifSegment()]), vieleStichworte, deps, null));
});
