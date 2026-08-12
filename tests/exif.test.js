"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { readExifDate, parseExifDateString } = require("../exif.js");
const { buildApp1XmpSegment } = require("../jpeg-segments.js");
const { buildXmpPacket } = require("../xmp-packet.js");
const { buildJpeg, buildExifApp1, jfifSegment } = require("./helpers.js");

/** readExifDate erwartet einen ArrayBuffer, nicht das Uint8Array. */
function datumAus(jpegBytes) {
  return readExifDate(jpegBytes.buffer.slice(jpegBytes.byteOffset, jpegBytes.byteOffset + jpegBytes.byteLength));
}

test("parseExifDateString liest das EXIF-Datumsformat", () => {
  const d = parseExifDateString("2019:07:04 12:34:56");
  assert.strictEqual(d.getFullYear(), 2019);
  assert.strictEqual(d.getMonth(), 6); // 0-basiert
  assert.strictEqual(d.getDate(), 4);
  assert.strictEqual(d.getHours(), 12);
  assert.strictEqual(d.getMinutes(), 34);
  assert.strictEqual(d.getSeconds(), 56);
});

test("parseExifDateString lehnt Fremdformate ab", () => {
  assert.strictEqual(parseExifDateString("04.07.2019"), null);
  assert.strictEqual(parseExifDateString(""), null);
});

test("das Aufnahmedatum wird aus einem big-endian TIFF gelesen", () => {
  const d = datumAus(buildJpeg([jfifSegment(), buildExifApp1("2019:07:04 12:34:56")]));
  assert.ok(d, "es muss ein Datum gefunden werden");
  assert.strictEqual(d.getFullYear(), 2019);
  assert.strictEqual(d.getDate(), 4);
});

test("das Aufnahmedatum wird auch aus einem little-endian TIFF gelesen", () => {
  const d = datumAus(buildJpeg([jfifSegment(), buildExifApp1("2021:11:30 08:09:10", true)]));
  assert.ok(d);
  assert.strictEqual(d.getFullYear(), 2021);
  assert.strictEqual(d.getMonth(), 10);
  assert.strictEqual(d.getDate(), 30);
});

test("das EXIF-Segment wird auch gefunden, wenn ein XMP-APP1 davor steht", () => {
  // Regression zu Befund M4: die Segmentschleife brach beim ERSTEN APP1 ab. Stand
  // dort XMP statt EXIF, galt das Foto als "ohne Aufnahmedatum" und bekam
  // stillschweigend das Dateidatum - was auch in den Zieldateinamen einfloss.
  const jpeg = buildJpeg([
    jfifSegment(),
    buildApp1XmpSegment(buildXmpPacket(["vorne"], null)),
    buildExifApp1("2019:07:04 12:34:56"),
  ]);
  const d = datumAus(jpeg);
  assert.ok(d, "das EXIF-Segment hinter dem XMP-Segment muss gefunden werden");
  assert.strictEqual(d.getFullYear(), 2019);
  assert.strictEqual(d.getHours(), 12);
});

test("ein JPEG ohne EXIF liefert null", () => {
  assert.strictEqual(datumAus(buildJpeg([jfifSegment()])), null);
});

test("ein JPEG mit nur XMP liefert null statt eines Fehlers", () => {
  const jpeg = buildJpeg([buildApp1XmpSegment(buildXmpPacket(["x"], null))]);
  assert.strictEqual(datumAus(jpeg), null);
});

test("Fremddaten liefern null statt zu werfen", () => {
  assert.strictEqual(readExifDate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer), null);
  assert.strictEqual(readExifDate(new Uint8Array(0).buffer), null);
});

test("ein abgeschnittenes EXIF-Segment liefert null statt zu werfen", () => {
  const jpeg = buildJpeg([jfifSegment(), buildExifApp1("2019:07:04 12:34:56")]);
  assert.doesNotThrow(() => datumAus(jpeg.slice(0, 30)));
});

test("ein Segment mit ungültiger Länge führt nicht zur Endlosschleife", () => {
  // Längenfeld 0 wäre ohne Abbruchbedingung eine Endlosschleife.
  const kaputt = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0x00, 0x00, 0xff, 0xd9]);
  assert.strictEqual(readExifDate(kaputt.buffer), null);
});
