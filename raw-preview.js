/**
 * Findet in RAW-Dateien das eingebettete JPEG-Vorschaubild.
 *
 * Warum überhaupt: RAW-Dateien lassen sich im Browser nicht decodieren - im Grid
 * blieb bisher ein grauer Kasten. Praktisch jede Kamera legt aber ein fertiges
 * JPEG mit in die Datei (das, was auf dem Kameradisplay zu sehen ist). Das lässt
 * sich ohne jede RAW-Decodierung herausschneiden und ganz normal anzeigen.
 *
 * Zwei Wege, in dieser Reihenfolge:
 *
 * 1. ÜBER DIE STRUKTUR. Fast alle RAW-Formate (CR2, NEF, ARW, DNG, ORF, SRW,
 *    RW2) sind TIFF-Varianten; die Lage des Vorschau-JPEGs steht dort in den
 *    IFD-Einträgen. RAF (Fuji) ist kein TIFF, hat die Angabe aber an einer
 *    festen Stelle im Kopf. Dieser Weg braucht nur den Dateianfang und liefert
 *    exakte Grenzen.
 * 2. ÜBER EINE BYTE-SUCHE. Findet der erste Weg nichts (unbekannte Variante,
 *    ungewöhnliche Verschachtelung), wird nach JPEG-Start- und -Endmarken
 *    gesucht. Grob, aber formatunabhängig.
 *
 * Beide Wege liefern nur KANDIDATEN mit Byte-Bereichen. Ob sich daraus ein Bild
 * decodieren lässt, entscheidet der Browser - der Aufrufer probiert die
 * Kandidaten der Größe nach durch, weil der größte Bereich in aller Regel die
 * hochauflösende Vorschau ist und die kleineren die Miniaturbilder sind.
 *
 * Die Datei wird dabei ausschließlich GELESEN. Beim Verschieben wird eine
 * RAW-Datei unverändert kopiert; dieses Modul ist am Schreibpfad nicht beteiligt.
 */

/** Kleinste Größe, ab der ein gefundener Bereich als Vorschau ernst genommen wird. */
const MIN_EMBEDDED_JPEG_BYTES = 1024;

/** Grenze für die Anzahl durchlaufener IFDs - schützt vor zyklischen Verweisen in defekten Dateien. */
const MAX_IFD_VISITS = 64;

/* ---- TIFF-Grundlagen ---- */

/** Bytegrößen der TIFF-Feldtypen, indiziert mit dem Typcode. 0 = unbekannt. */
const TIFF_TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

const TIFF_TAG_STRIP_OFFSETS = 0x0111;
const TIFF_TAG_COMPRESSION = 0x0103;
const TIFF_TAG_STRIP_BYTE_COUNTS = 0x0117;
const TIFF_TAG_SUB_IFDS = 0x014a;
const TIFF_TAG_JPEG_INTERCHANGE_FORMAT = 0x0201;
const TIFF_TAG_JPEG_INTERCHANGE_FORMAT_LENGTH = 0x0202;
const TIFF_TAG_EXIF_IFD = 0x8769;
/** Panasonic RW2: das komplette Vorschau-JPEG steht direkt im Feldwert. */
const TIFF_TAG_PANASONIC_JPEG_FROM_RAW = 0x002e;

/** JPEG-Kompressionskennungen in TIFF (6 = altes JPEG, 7 = JPEG nach TIFF-Technote 2). */
const TIFF_COMPRESSION_JPEG = new Set([6, 7]);

function readUint16(bytes, offset, littleEndian) {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset, littleEndian) {
  const value = littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  // >>> 0: die Bitoperationen oben rechnen vorzeichenbehaftet, Dateioffsets sind es nicht.
  return value >>> 0;
}

/**
 * Erkennt den TIFF-Kopf und liefert Byte-Reihenfolge und Offset des ersten IFD.
 * Akzeptiert neben der regulären Magic 42 auch die herstellereigenen Varianten
 * (Olympus ORF, Panasonic RW2) - der Aufbau dahinter ist derselbe.
 * @returns {{littleEndian: boolean, firstIfdOffset: number}|null}
 */
function readTiffHeader(bytes) {
  if (bytes.length < 8) return null;
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== "II" && order !== "MM") return null;
  const littleEndian = order === "II";
  const magic = readUint16(bytes, 2, littleEndian);
  // 42 = TIFF/DNG/CR2/NEF/ARW/SRW, 0x4f52+0x5352 = ORF, 0x55 = RW2
  if (magic !== 42 && magic !== 0x4f52 && magic !== 0x5352 && magic !== 0x55) return null;
  return { littleEndian, firstIfdOffset: readUint32(bytes, 4, littleEndian) };
}

/**
 * Liest die Werte eines IFD-Eintrags als Zahlen. Passen sie in vier Byte, stehen
 * sie direkt im Eintrag, sonst verweist der Eintrag auf eine Stelle in der Datei.
 * Liefert eine leere Liste, wenn die Werte außerhalb des vorliegenden Puffers
 * liegen - beim Parsen eines Dateianfangs ist das der Normalfall und kein Fehler.
 */
function readIfdEntryValues(bytes, entryOffset, littleEndian) {
  const type = readUint16(bytes, entryOffset + 2, littleEndian);
  const count = readUint32(bytes, entryOffset + 4, littleEndian);
  const typeSize = TIFF_TYPE_SIZES[type] || 0;
  if (typeSize === 0 || count === 0 || count > 0xffff) return [];

  const totalSize = typeSize * count;
  const valueStart = totalSize <= 4
    ? entryOffset + 8
    : readUint32(bytes, entryOffset + 8, littleEndian);
  if (valueStart + totalSize > bytes.length) return [];

  const values = [];
  for (let i = 0; i < count; i++) {
    const at = valueStart + i * typeSize;
    if (typeSize === 1) values.push(bytes[at]);
    else if (typeSize === 2) values.push(readUint16(bytes, at, littleEndian));
    else if (typeSize === 4) values.push(readUint32(bytes, at, littleEndian));
    else return []; // RATIONAL o. Ä. - für Offsets/Längen nicht vorgesehen
  }
  return values;
}

/**
 * Durchläuft die IFD-Kette ab einem Offset und sammelt Kandidaten für
 * eingebettete JPEGs ein. Verweise auf Unter-IFDs (SubIFDs, Exif-IFD) werden
 * mitverfolgt: bei NEF und DNG steht die große Vorschau typischerweise dort.
 */
function collectFromIfdChain(bytes, startOffset, littleEndian, fileSize, state) {
  let offset = startOffset;
  while (offset > 0 && offset + 2 <= bytes.length) {
    if (state.visits++ > MAX_IFD_VISITS) return;
    if (state.seen.has(offset)) return; // Zyklus in einer defekten Datei
    state.seen.add(offset);

    const entryCount = readUint16(bytes, offset, littleEndian);
    const entriesEnd = offset + 2 + entryCount * 12;
    if (entryCount === 0 || entriesEnd + 4 > bytes.length) return;

    let jpegOffset = null;
    let jpegLength = null;
    let stripOffset = null;
    let stripLength = null;
    let compression = null;
    const subIfdOffsets = [];

    for (let i = 0; i < entryCount; i++) {
      const entryOffset = offset + 2 + i * 12;
      const tag = readUint16(bytes, entryOffset, littleEndian);
      switch (tag) {
        case TIFF_TAG_JPEG_INTERCHANGE_FORMAT:
          jpegOffset = readIfdEntryValues(bytes, entryOffset, littleEndian)[0] ?? null;
          break;
        case TIFF_TAG_JPEG_INTERCHANGE_FORMAT_LENGTH:
          jpegLength = readIfdEntryValues(bytes, entryOffset, littleEndian)[0] ?? null;
          break;
        case TIFF_TAG_STRIP_OFFSETS: {
          const values = readIfdEntryValues(bytes, entryOffset, littleEndian);
          if (values.length === 1) stripOffset = values[0];
          break;
        }
        case TIFF_TAG_STRIP_BYTE_COUNTS: {
          const values = readIfdEntryValues(bytes, entryOffset, littleEndian);
          if (values.length === 1) stripLength = values[0];
          break;
        }
        case TIFF_TAG_COMPRESSION:
          compression = readIfdEntryValues(bytes, entryOffset, littleEndian)[0] ?? null;
          break;
        case TIFF_TAG_SUB_IFDS:
          subIfdOffsets.push(...readIfdEntryValues(bytes, entryOffset, littleEndian));
          break;
        case TIFF_TAG_EXIF_IFD: {
          const value = readIfdEntryValues(bytes, entryOffset, littleEndian)[0];
          if (value) subIfdOffsets.push(value);
          break;
        }
        case TIFF_TAG_PANASONIC_JPEG_FROM_RAW: {
          // Der Wert IST das JPEG; Länge = Anzahl der Bytes des Feldes.
          const count = readUint32(bytes, entryOffset + 4, littleEndian);
          if (count > 4) {
            state.candidates.push({
              offset: readUint32(bytes, entryOffset + 8, littleEndian),
              length: count,
              source: "panasonic",
            });
          }
          break;
        }
        default:
          break;
      }
    }

    if (jpegOffset !== null && jpegLength) {
      state.candidates.push({ offset: jpegOffset, length: jpegLength, source: "jpeg-interchange" });
    }
    // Ein einzelner Streifen mit JPEG-Kompression ist bei CR2 und ORF die
    // hochauflösende Vorschau. Bei mehreren Streifen sind es Bilddaten-Kacheln,
    // aus denen sich kein einzelnes JPEG schneiden lässt - die bleiben außen vor.
    if (stripOffset !== null && stripLength && compression !== null && TIFF_COMPRESSION_JPEG.has(compression)) {
      state.candidates.push({ offset: stripOffset, length: stripLength, source: "strip" });
    }

    for (const sub of subIfdOffsets) {
      collectFromIfdChain(bytes, sub, littleEndian, fileSize, state);
    }

    offset = readUint32(bytes, entriesEnd, littleEndian);
  }
}

/* ---- RAF (Fujifilm) ---- */

const RAF_MAGIC = "FUJIFILMCCD-RAW";
/** Feste Lage der Angaben im RAF-Kopf: Offset bei 84, Länge bei 88, jeweils big-endian. */
const RAF_JPEG_OFFSET_POSITION = 84;

function readRafCandidate(bytes) {
  if (bytes.length < RAF_JPEG_OFFSET_POSITION + 8) return null;
  for (let i = 0; i < RAF_MAGIC.length; i++) {
    if (bytes[i] !== RAF_MAGIC.charCodeAt(i)) return null;
  }
  const offset = readUint32(bytes, RAF_JPEG_OFFSET_POSITION, false);
  const length = readUint32(bytes, RAF_JPEG_OFFSET_POSITION + 4, false);
  if (!offset || !length) return null;
  return { offset, length, source: "raf" };
}

/* ---- Öffentliche Funktionen ---- */

/**
 * Ermittelt aus dem ANFANG einer RAW-Datei, wo eingebettete JPEGs liegen.
 *
 * Es genügt der Dateianfang, weil hier nur die Verzeichnisstrukturen gelesen
 * werden - die JPEG-Daten selbst können beliebig weit hinten liegen und werden
 * vom Aufrufer gezielt nachgeladen. Genau deshalb ist diese Funktion vom
 * Dateizugriff getrennt: sie bekommt Bytes und liefert Bereiche.
 *
 * @param {Uint8Array} headerBytes - Anfang der Datei (einige hundert KB genügen)
 * @param {number} fileSize - Gesamtgröße der Datei, für die Plausibilitätsprüfung
 * @returns {Array<{offset: number, length: number, source: string}>} größte zuerst
 */
function findEmbeddedJpegRanges(headerBytes, fileSize) {
  const state = { candidates: [], seen: new Set(), visits: 0 };

  const raf = readRafCandidate(headerBytes);
  if (raf) {
    state.candidates.push(raf);
  } else {
    const header = readTiffHeader(headerBytes);
    if (header) {
      collectFromIfdChain(headerBytes, header.firstIfdOffset, header.littleEndian, fileSize, state);
    }
  }

  return dedupeAndSortRanges(state.candidates, fileSize);
}

/**
 * Sucht in einem Byte-Bereich nach vollständigen JPEG-Bildern (Startmarke FFD8FF
 * bis Endmarke FFD9). Der Rückfallweg, wenn die Struktur nichts hergab.
 *
 * Bewusst simpel: die Suche kann in den Bilddaten eines gefundenen JPEGs weitere
 * Startmarken finden, die keine sind. Das schadet nicht, weil der Aufrufer die
 * Kandidaten ohnehin nur der Größe nach durchprobiert und ein nicht decodierbarer
 * Bereich einfach übersprungen wird.
 *
 * @param {Uint8Array} bytes
 * @param {number} [baseOffset] - Offset von `bytes` innerhalb der Datei
 * @returns {Array<{offset: number, length: number, source: string}>} größte zuerst
 */
function scanForJpegRanges(bytes, baseOffset) {
  const base = baseOffset || 0;
  const found = [];
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    for (let j = i + 3; j + 1 < bytes.length; j++) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
        found.push({ offset: base + i, length: j + 2 - i, source: "scan" });
        i = j + 1; // hinter dem gefundenen Bild weitersuchen
        break;
      }
    }
  }
  return dedupeAndSortRanges(found, base + bytes.length);
}

/**
 * Verwirft unplausible Bereiche (außerhalb der Datei, zu klein) und Dubletten,
 * und sortiert absteigend nach Größe: der größte Bereich ist die beste Vorschau.
 */
function dedupeAndSortRanges(ranges, fileSize) {
  const seen = new Set();
  const result = [];
  for (const range of ranges) {
    if (!Number.isFinite(range.offset) || !Number.isFinite(range.length)) continue;
    if (range.offset < 0 || range.length < MIN_EMBEDDED_JPEG_BYTES) continue;
    if (fileSize && range.offset + range.length > fileSize) continue;
    const key = `${range.offset}:${range.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(range);
  }
  result.sort((a, b) => b.length - a.length);
  return result;
}

if (typeof module !== "undefined") {
  module.exports = {
    findEmbeddedJpegRanges,
    scanForJpegRanges,
    readTiffHeader,
    dedupeAndSortRanges,
    MIN_EMBEDDED_JPEG_BYTES,
  };
}
