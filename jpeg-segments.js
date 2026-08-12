/**
 * JPEG-Segment-Handling für das Schreiben von IPTC-Metadaten.
 * Strategie: das JPEG wird als Folge von Markern/Segmenten durchlaufen (wie beim
 * Lesen in exif.js), bis zum Start-of-Scan (Bilddaten). Nur das APP13-Segment
 * ("Photoshop 3.0" + Image Resource Blocks) wird ersetzt bzw. neu eingefügt -
 * alle anderen Segmente (APP0/JFIF, APP1/EXIF, APP2/ICC, etc.) und die
 * Bilddaten selbst bleiben byteidentisch erhalten.
 */

const PHOTOSHOP_PREAMBLE = "Photoshop 3.0\0"; // exakt 14 Bytes, Standard-Präfix von Adobe
const XMP_PREAMBLE = "http://ns.adobe.com/xap/1.0/\0"; // exakt 29 Bytes, Standard-Präfix für XMP in JPEG APP1

/**
 * Zerlegt ein JPEG in seine Segmente bis zum Start-of-Scan.
 * @param {Uint8Array} buffer
 * @returns {{ segments: Array<{marker: number, start: number, end: number}>, scanStart: number }}
 */
function parseJpegSegments(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Keine gültige JPEG-Datei (SOI-Marker fehlt).");
  }
  const segments = [];
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      throw new Error(`Ungültiger JPEG-Marker bei Offset ${offset} (erwartet 0xFF).`);
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Marker ohne Längenfeld (SOI, TEM, RSTn) - hier nicht relevant vor SOS, überspringen
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      // Start of Scan erreicht - ab hier folgen komprimierte Bilddaten, keine weiteren markierten Segmente mehr
      return { segments, scanStart: offset };
    }
    const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
    const segmentEnd = offset + 2 + length; // Länge inkl. der 2 Längen-Bytes selbst, exkl. Marker
    segments.push({ marker, start: offset, end: segmentEnd });
    offset = segmentEnd;
  }
  throw new Error("Kein Start-of-Scan-Marker gefunden - Datei unvollständig oder kein gültiges JPEG.");
}

/**
 * Liest exakt `length` Bytes ab `start` und wandelt sie 1:1 in einen String um
 * (ein Byte = ein Zeichencode, auch für Nullbytes - kein Abbruch bei 0x00).
 * Wichtig: ein Abbruch beim ersten Nullbyte (wie man es von C-Strings kennt)
 * würde bei Präfixen mit mehreren Nullbytes (z. B. "Exif\0\0") zu kurze und
 * damit nie passende Vergleichsstrings erzeugen.
 *
 * Liegt der angeforderte Bereich nicht vollständig im Puffer (Segment kürzer als
 * die erwartete Präambel), wird "" zurückgegeben: buffer[i] wäre dort undefined
 * und String.fromCharCode(undefined) ergäbe ein Zeichen, das zufällig passen könnte.
 */
function readAsciiPrefix(buffer, start, length) {
  if (start < 0 || start + length > buffer.length) return "";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(buffer[start + i]);
  }
  return str;
}

/**
 * Baut ein komplettes JPEG-APP13-Segment (Marker + Länge + "Photoshop 3.0\0" + IRB-Daten).
 * @param {Uint8Array} irbData - eine oder mehrere aneinandergereihte Image Resource Blocks
 */
function buildApp13Segment(irbData) {
  const preambleBytes = new TextEncoder().encode(PHOTOSHOP_PREAMBLE);
  const payloadLength = preambleBytes.length + irbData.length;
  const totalLength = 2 + payloadLength; // Längenfeld zählt sich selbst mit (2 Bytes)
  if (totalLength > 0xffff) {
    throw new Error("APP13-Segment zu groß (>65533 Bytes) - zu viele/lange Stichworte für ein einzelnes Segment.");
  }
  const segment = new Uint8Array(2 + totalLength); // Marker(2) + Länge(2) + Payload
  segment[0] = 0xff;
  segment[1] = 0xed;
  segment[2] = (totalLength >> 8) & 0xff;
  segment[3] = totalLength & 0xff;
  segment.set(preambleBytes, 4);
  segment.set(irbData, 4 + preambleBytes.length);
  return segment;
}

/**
 * Schreibt sowohl IPTC-IIM- als auch XMP-Metadaten (Stichworte UND optional
 * eine Beschreibung) in eine JPEG-Datei, in einem einzigen Durchgang.
 * @param {Uint8Array} originalBuffer
 * @param {string[]} keywords
 * @param {{buildIptcIimBlock: Function, buildIrbForIptc: Function, parseIrbs: Function, buildXmpPacket: Function}} deps
 * @param {string} [description] - optionale Beschreibung (IPTC Caption/Abstract, XMP dc:description)
 */
function writeKeywordsToJpeg(originalBuffer, keywords, deps, description) {
  const { segments, scanStart } = parseJpegSegments(originalBuffer);

  let existingApp13 = null;
  let existingXmpApp1 = null;
  for (const seg of segments) {
    if (seg.marker === 0xed && !existingApp13) {
      const prefix = readAsciiPrefix(originalBuffer, seg.start + 4, PHOTOSHOP_PREAMBLE.length);
      if (prefix === PHOTOSHOP_PREAMBLE) existingApp13 = seg;
    } else if (seg.marker === 0xe1 && !existingXmpApp1) {
      const prefix = readAsciiPrefix(originalBuffer, seg.start + 4, XMP_PREAMBLE.length);
      if (prefix === XMP_PREAMBLE) existingXmpApp1 = seg;
    }
  }

  // --- IPTC-APP13 vorbereiten (bestehende Nicht-IPTC-IRBs, z.B. Thumbnails, bleiben erhalten) ---
  const newIptcBlock = deps.buildIptcIimBlock(keywords, description);
  const newIptcIrb = deps.buildIrbForIptc(newIptcBlock);
  let newIrbChainBytes;
  if (existingApp13) {
    const payloadStart = existingApp13.start + 4 + PHOTOSHOP_PREAMBLE.length;
    const irbBuffer = originalBuffer.slice(payloadStart, existingApp13.end);
    const existingIrbs = deps.parseIrbs(irbBuffer);
    const keptChunks = [];
    for (const irb of existingIrbs) {
      if (irb.resourceId === 0x0404) continue; // altes IPTC wird ersetzt, alles andere bleibt
      keptChunks.push(irbBuffer.slice(irb.start, irb.end));
    }
    keptChunks.push(newIptcIrb);
    newIrbChainBytes = concatAll(keptChunks);
  } else {
    newIrbChainBytes = newIptcIrb;
  }
  const newApp13Segment = buildApp13Segment(newIrbChainBytes);

  // --- XMP-APP1 vorbereiten ---
  const xmpPacketString = deps.buildXmpPacket(keywords, description);
  const newApp1XmpSegment = buildApp1XmpSegment(xmpPacketString);

  // --- Neues JPEG zusammensetzen: einmal linear durch alle Segmente vor dem Scan
  //     laufen. Das alte APP13 (Photoshop) und alte XMP-APP1 werden übersprungen
  //     (nicht kopiert); an der Position des JEWEILS ERSTEN entfernten Segments
  //     (oder direkt nach SOI, falls keines existierte) werden die zwei neuen
  //     Segmente eingefügt. Alle anderen Segmente (EXIF, ICC, JFIF, ...) werden
  //     unverändert 1:1 übernommen. Die Bilddaten ab scanStart bleiben ohnehin
  //     komplett unangetastet, da sie außerhalb dieser Schleife separat angehängt werden.
  const outputChunks = [originalBuffer.slice(0, 2)]; // SOI-Marker unverändert übernehmen
  let inserted = false;
  let cursor = 2; // nach SOI

  function maybeInsertHere() {
    if (!inserted) {
      outputChunks.push(newApp13Segment);
      outputChunks.push(newApp1XmpSegment);
      inserted = true;
    }
  }

  if (segments.length === 0) {
    // Kein einziges Segment vor dem Scan (extrem minimales JPEG) -> direkt einfügen
    maybeInsertHere();
  }

  for (const seg of segments) {
    const isOldApp13 = seg === existingApp13;
    const isOldXmpApp1 = seg === existingXmpApp1;
    if (isOldApp13 || isOldXmpApp1) {
      // Lücke VOR diesem zu entfernenden Segment erst normal übernehmen,
      // dann an dieser Stelle (spätestens beim ersten Treffer) die neuen Segmente einfügen.
      outputChunks.push(originalBuffer.slice(cursor, seg.start));
      maybeInsertHere();
      cursor = seg.end; // Segment selbst überspringen (nicht kopieren)
    } else {
      outputChunks.push(originalBuffer.slice(cursor, seg.end));
      cursor = seg.end;
    }
  }
  // Falls es weder ein altes APP13 noch ein altes XMP-APP1 gab, wurden die neuen
  // Segmente noch nicht eingefügt - das passiert dann jetzt, vor den Bilddaten.
  maybeInsertHere();

  outputChunks.push(originalBuffer.slice(cursor, scanStart));
  outputChunks.push(originalBuffer.slice(scanStart)); // Bilddaten: garantiert unverändert

  return concatAll(outputChunks);
}

function concatAll(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

/**
 * Baut ein komplettes JPEG-APP1-Segment für XMP (Marker + Länge + Präfix + XMP-XML-Text).
 * @param {string} xmpPacketString
 */
function buildApp1XmpSegment(xmpPacketString) {
  const preambleBytes = new TextEncoder().encode(XMP_PREAMBLE);
  const xmpBytes = new TextEncoder().encode(xmpPacketString);
  const payloadLength = preambleBytes.length + xmpBytes.length;
  const totalLength = 2 + payloadLength;
  if (totalLength > 0xffff) {
    throw new Error("XMP-Paket zu groß für ein einzelnes APP1-Segment (>65533 Bytes). Erweiterte XMP-Segmente werden nicht unterstützt.");
  }
  const segment = new Uint8Array(2 + totalLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (totalLength >> 8) & 0xff;
  segment[3] = totalLength & 0xff;
  segment.set(preambleBytes, 4);
  segment.set(xmpBytes, 4 + preambleBytes.length);
  return segment;
}

if (typeof module !== "undefined") {
  module.exports = {
    parseJpegSegments,
    buildApp13Segment,
    buildApp1XmpSegment,
    writeKeywordsToJpeg,
    PHOTOSHOP_PREAMBLE,
    XMP_PREAMBLE,
  };
}
