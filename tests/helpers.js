/**
 * Gemeinsame Hilfsfunktionen für die Node-Tests: bauen JPEG- und EXIF-Strukturen
 * synthetisch auf.
 *
 * Warum synthetisch und keine Beispieldateien im Repo: die Tests sollen genau
 * eine Eigenschaft prüfen und dabei aussagen können, WELCHES Byte falsch ist.
 * Eine echte Kameradatei bringt hunderte irrelevante Segmente mit und würde das
 * Repository um Megabytes aufblähen. Die Strukturen hier sind vollständig
 * formatkonform bis zum Start-of-Scan - das ist der Bereich, den der Code
 * überhaupt anfasst; die "Bilddaten" dahinter sind bewusst beliebige Bytes,
 * denn genau ihre Unveränderlichkeit ist das, was geprüft wird.
 */

"use strict";

/** Baut ein APPn-Segment: Marker + Länge + Payload. */
function buildAppSegment(markerLowByte, payloadBytes) {
  const totalLength = 2 + payloadBytes.length; // Längenfeld zählt sich selbst mit
  const segment = new Uint8Array(4 + payloadBytes.length);
  segment[0] = 0xff;
  segment[1] = markerLowByte;
  segment[2] = (totalLength >> 8) & 0xff;
  segment[3] = totalLength & 0xff;
  segment.set(payloadBytes, 4);
  return segment;
}

function ascii(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

function concat(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

/** Ein APP0/JFIF-Segment, wie es praktisch jedes JPEG am Anfang hat. */
function jfifSegment() {
  return buildAppSegment(0xe0, concat([
    ascii("JFIF\0"),
    new Uint8Array([0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]));
}

/**
 * Baut ein strukturell gültiges JPEG: SOI, die übergebenen Segmente, dann SOS
 * mit anschließenden "Bilddaten" und EOI.
 * @param {Uint8Array[]} segments - fertige Segmente (Marker+Länge+Payload)
 * @param {Uint8Array} [imageData] - Bytes nach dem SOS-Header
 */
function buildJpeg(segments, imageData) {
  const sosHeader = new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scan = imageData || new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
  return concat([
    new Uint8Array([0xff, 0xd8]), // SOI
    ...segments,
    sosHeader,
    scan,
    new Uint8Array([0xff, 0xd9]), // EOI
  ]);
}

/**
 * Baut ein EXIF-APP1-Segment mit DateTimeOriginal im Exif-Sub-IFD.
 * @param {string} dateString - im EXIF-Format "JJJJ:MM:TT HH:MM:SS"
 * @param {boolean} [littleEndian] - TIFF-Byteorder ("II" statt "MM")
 */
function buildExifApp1(dateString, littleEndian) {
  // TIFF-Aufbau (Offsets relativ zum TIFF-Start):
  //   0  Byteorder + Magic + Offset auf IFD0 (= 8)
  //   8  IFD0: 1 Eintrag (Zeiger auf Exif-Sub-IFD bei 26), danach Next-IFD = 0
  //  26  Sub-IFD: 1 Eintrag (DateTimeOriginal, Wert bei 44), Next-IFD = 0
  //  44  20 Bytes ASCII inkl. Null-Terminator
  const tiff = new Uint8Array(64);
  const view = new DataView(tiff.buffer);
  const le = !!littleEndian;

  view.setUint16(0, le ? 0x4949 : 0x4d4d);
  view.setUint16(2, 0x002a, le);
  view.setUint32(4, 8, le);

  view.setUint16(8, 1, le);
  view.setUint16(10, 0x8769, le); // Exif-Sub-IFD-Zeiger
  view.setUint16(12, 4, le);      // Typ LONG
  view.setUint32(14, 1, le);
  view.setUint32(18, 26, le);
  view.setUint32(22, 0, le);      // kein weiteres IFD

  view.setUint16(26, 1, le);
  view.setUint16(28, 0x9003, le); // DateTimeOriginal
  view.setUint16(30, 2, le);      // Typ ASCII
  view.setUint32(32, 20, le);
  view.setUint32(36, 44, le);
  view.setUint32(40, 0, le);

  const padded = (dateString + "\0").slice(0, 20);
  for (let i = 0; i < padded.length; i++) tiff[44 + i] = padded.charCodeAt(i);

  return buildAppSegment(0xe1, concat([ascii("Exif\0\0"), tiff]));
}

/** Die Bytes ab dem Start-of-Scan - der Teil, der beim Schreiben unverändert bleiben MUSS. */
function bytesFromScan(jpegBytes, parseJpegSegments) {
  const { scanStart } = parseJpegSegments(jpegBytes);
  return jpegBytes.slice(scanStart);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

module.exports = {
  ascii,
  concat,
  buildAppSegment,
  jfifSegment,
  buildJpeg,
  buildExifApp1,
  bytesFromScan,
  bytesEqual,
};
