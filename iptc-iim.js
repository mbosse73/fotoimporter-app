/**
 * IPTC-IIM (Information Interchange Model) - Kernkodierung.
 * Spezifikation: IPTC-NAA IIM Version 4.2
 *
 * Jedes DataSet: Marker(1C) + Record(1) + DataSet-Nr(1) + Länge(2, big-endian) + Daten
 * Record 2 = "Application Record". DataSet 2:25 = "Keywords" (wiederholbar, max 64 Bytes je Eintrag, UTF-8).
 * DataSet 2:00 = "Record Version" (Pflichtfeld, falls Record 2 verwendet wird) - 2 Bytes, Wert 4 (big-endian).
 */

const IPTC_MARKER = 0x1c;
const RECORD_APPLICATION = 2;
const DATASET_RECORD_VERSION = 0x00; // 2:00
const DATASET_KEYWORDS = 0x19; // 2:25
const DATASET_CAPTION_ABSTRACT = 0x78; // 2:120 "Caption/Abstract" (Beschreibung), nicht wiederholbar
const MAX_KEYWORD_BYTES = 64; // durch IIM-Spezifikation vorgegebene Obergrenze pro Keyword-DataSet
const MAX_CAPTION_BYTES = 2000; // durch IIM-Spezifikation vorgegebene Obergrenze für Caption/Abstract

/**
 * Baut ein einzelnes IPTC-IIM DataSet als Byte-Array.
 * @param {number} record
 * @param {number} dataset
 * @param {Uint8Array} dataBytes
 */
function encodeDataSet(record, dataset, dataBytes) {
  if (dataBytes.length > 0x7fff) {
    // IIM4 kennt zwar "extended DataSets" für >32767 Bytes, für Keywords (max 64) irrelevant.
    throw new Error("DataSet zu groß für einfache (nicht-erweiterte) Längenkodierung.");
  }
  const header = new Uint8Array(5);
  header[0] = IPTC_MARKER;
  header[1] = record;
  header[2] = dataset;
  header[3] = (dataBytes.length >> 8) & 0xff;
  header[4] = dataBytes.length & 0xff;
  const result = new Uint8Array(header.length + dataBytes.length);
  result.set(header, 0);
  result.set(dataBytes, header.length);
  return result;
}

/**
 * Kürzt einen String auf maximal maxBytes UTF-8-Bytes, ohne einen Mehrbyte-Codepoint
 * mittendrin abzuschneiden (das würde ungültiges UTF-8 erzeugen).
 */
function truncateUtf8(str, maxBytes) {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) return bytes;
  // Von maxBytes rückwärts zum nächsten gültigen Zeichengrenzwert suchen.
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--; // 0x80..0xBF = Fortsetzungs-Byte
  return bytes.slice(0, cut);
}

/**
 * Baut den kompletten IPTC-IIM-Block aus einer Liste von Stichwort-Strings und
 * optional einer Beschreibung. Enthält das Pflicht-DataSet "Record Version"
 * (2:00), gefolgt von einem eigenen, wiederholten DataSet 2:25 pro Stichwort
 * (kein zusammengefügter String) und - falls angegeben - genau einem DataSet
 * 2:120 "Caption/Abstract" für die Beschreibung (nicht wiederholbar).
 * @param {string[]} keywords
 * @param {string} [description] - optionale Beschreibung (IPTC 2:120 Caption/Abstract)
 * @returns {Uint8Array}
 */
function buildIptcIimBlock(keywords, description) {
  const parts = [];

  const versionBytes = new Uint8Array([0x00, 0x04]); // Record-Version 4, big-endian
  parts.push(encodeDataSet(RECORD_APPLICATION, DATASET_RECORD_VERSION, versionBytes));

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;
    const dataBytes = truncateUtf8(trimmed, MAX_KEYWORD_BYTES);
    parts.push(encodeDataSet(RECORD_APPLICATION, DATASET_KEYWORDS, dataBytes));
  }

  if (description && description.trim()) {
    const dataBytes = truncateUtf8(description.trim(), MAX_CAPTION_BYTES);
    parts.push(encodeDataSet(RECORD_APPLICATION, DATASET_CAPTION_ABSTRACT, dataBytes));
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

/**
 * Parst einen IPTC-IIM-Block zurück in Stichwörter (DataSet 2:25) und die
 * Beschreibung (DataSet 2:120, "Caption/Abstract"). Wird für den Konsistenz-
 * Check nach dem Schreiben verwendet: die neu erzeugte Datei wird sofort
 * wieder eingelesen und verglichen, bevor sie das Original ersetzt.
 * @param {Uint8Array} block
 * @returns {{keywords: string[], description: string|null}}
 */
function parseIptcIimData(block) {
  const keywords = [];
  let description = null;
  const decoder = new TextDecoder("utf-8");
  let offset = 0;
  while (offset < block.length) {
    if (block[offset] !== IPTC_MARKER) {
      // Kein gültiges DataSet mehr an dieser Position - Block zu Ende oder beschädigt.
      break;
    }
    const record = block[offset + 1];
    const dataset = block[offset + 2];
    const length = (block[offset + 3] << 8) | block[offset + 4];
    const dataStart = offset + 5;
    const dataEnd = dataStart + length;
    if (dataEnd > block.length) break; // unvollständiges DataSet, Abbruch

    if (record === RECORD_APPLICATION && dataset === DATASET_KEYWORDS) {
      keywords.push(decoder.decode(block.slice(dataStart, dataEnd)));
    } else if (record === RECORD_APPLICATION && dataset === DATASET_CAPTION_ABSTRACT) {
      description = decoder.decode(block.slice(dataStart, dataEnd));
    }
    offset = dataEnd;
  }
  return { keywords, description };
}

/**
 * Kompatibilitäts-Wrapper: liefert nur die Stichwörter (wie die frühere, engere
 * Funktion). Neuer Code sollte parseIptcIimData() verwenden, wenn auch die
 * Beschreibung gebraucht wird.
 * @param {Uint8Array} block
 * @returns {string[]}
 */
function parseIptcIimKeywords(block) {
  return parseIptcIimData(block).keywords;
}

if (typeof module !== "undefined") {
  module.exports = {
    encodeDataSet,
    truncateUtf8,
    buildIptcIimBlock,
    parseIptcIimKeywords,
    parseIptcIimData,
    MAX_KEYWORD_BYTES,
    MAX_CAPTION_BYTES,
  };
}
