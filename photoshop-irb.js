/**
 * Photoshop "Image Resource Block" (IRB) - Container-Format, das den IPTC-IIM-Block
 * für die Einbettung in JPEG (APP13) bzw. TIFF verpackt.
 * Layout: "8BIM"(4) + ResourceID(2, big-endian) + Pascal-Name (>=2 Byte, gerade Länge)
 *         + Größe(4, big-endian) + Daten (auf gerade Länge gepolstert)
 */

const IRB_SIGNATURE = [0x38, 0x42, 0x49, 0x4d]; // "8BIM"
const IRB_RESOURCE_ID_IPTC = 0x0404;

/**
 * Baut ein einzelnes Image Resource Block für den übergebenen IPTC-IIM-Inhalt.
 * @param {Uint8Array} iptcBlock
 * @returns {Uint8Array}
 */
function buildIrbForIptc(iptcBlock) {
  const nameBytes = new Uint8Array([0x00, 0x00]); // leerer Pascal-Name, bereits gerade Länge
  const paddedData = padToEvenLength(iptcBlock);

  const header = new Uint8Array(4 + 2 + nameBytes.length + 4);
  let offset = 0;
  header.set(IRB_SIGNATURE, offset); offset += 4;
  header[offset++] = (IRB_RESOURCE_ID_IPTC >> 8) & 0xff;
  header[offset++] = IRB_RESOURCE_ID_IPTC & 0xff;
  header.set(nameBytes, offset); offset += nameBytes.length;
  // Größe bezieht sich auf die UNGEPOLSTERTE Originallänge der Daten, nicht die gepolsterte.
  const size = iptcBlock.length;
  header[offset++] = (size >>> 24) & 0xff;
  header[offset++] = (size >>> 16) & 0xff;
  header[offset++] = (size >>> 8) & 0xff;
  header[offset++] = size & 0xff;

  const result = new Uint8Array(header.length + paddedData.length);
  result.set(header, 0);
  result.set(paddedData, header.length);
  return result;
}

function padToEvenLength(bytes) {
  if (bytes.length % 2 === 0) return bytes;
  const padded = new Uint8Array(bytes.length + 1);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x00;
  return padded;
}

/**
 * Durchsucht eine Folge von Image Resource Blocks (wie sie typischerweise
 * hintereinander in einem APP13-Segment vorkommen) und gibt alle gefundenen
 * IPTC-IIM-Datenblöcke (Resource-ID 0x0404) zurück, sowie die jeweiligen
 * Byte-Bereiche im Ursprungspuffer (für gezieltes Ersetzen beim Schreiben).
 * @param {Uint8Array} buffer - Inhalt des APP13-Segments NACH dem "Photoshop 3.0\0"-Präfix
 * @returns {Array<{start: number, end: number, resourceId: number, data: Uint8Array}>}
 */
function parseIrbs(buffer) {
  const blocks = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    if (
      buffer[offset] !== IRB_SIGNATURE[0] ||
      buffer[offset + 1] !== IRB_SIGNATURE[1] ||
      buffer[offset + 2] !== IRB_SIGNATURE[2] ||
      buffer[offset + 3] !== IRB_SIGNATURE[3]
    ) {
      break; // kein weiteres gültiges IRB, Ende der Kette
    }
    const blockStart = offset;
    let p = offset + 4;
    const resourceId = (buffer[p] << 8) | buffer[p + 1];
    p += 2;

    // Pascal-String-Name lesen: erstes Byte = Länge, dann auf gerade Gesamtlänge (inkl. Längenbyte) gepolstert
    const nameLen = buffer[p];
    let nameTotalLen = 1 + nameLen;
    if (nameTotalLen % 2 !== 0) nameTotalLen += 1;
    p += nameTotalLen;

    // >>> 0: die Größe ist laut Format vorzeichenlos. Ohne diese Umwandlung würde
    // ein gesetztes oberstes Bit eine negative Zahl ergeben und dataEnd vor
    // dataStart liegen - slice() lieferte dann stillschweigend einen leeren Block.
    const size = ((buffer[p] << 24) | (buffer[p + 1] << 16) | (buffer[p + 2] << 8) | buffer[p + 3]) >>> 0;
    p += 4;

    const dataStart = p;
    const dataEnd = dataStart + size;
    const paddedDataEnd = size % 2 === 0 ? dataEnd : dataEnd + 1;

    if (paddedDataEnd > buffer.length) break; // unvollständig / beschädigt, Abbruch

    blocks.push({
      start: blockStart,
      end: paddedDataEnd,
      resourceId,
      data: buffer.slice(dataStart, dataEnd),
    });

    offset = paddedDataEnd;
  }
  return blocks;
}

if (typeof module !== "undefined") {
  module.exports = { buildIrbForIptc, parseIrbs, padToEvenLength, IRB_RESOURCE_ID_IPTC };
}
