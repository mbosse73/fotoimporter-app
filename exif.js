/**
 * Minimaler EXIF-Parser – liest ausschließlich das Aufnahmedatum (Tag 0x9003
 * DateTimeOriginal, Fallback 0x0132 DateTime) aus JPEG-Dateien.
 * Kein externes Paket nötig, arbeitet direkt auf einem ArrayBuffer.
 */

/**
 * Liefert das Aufnahmedatum als JS Date oder null, wenn keine EXIF-Daten
 * gefunden werden konnten.
 * @param {ArrayBuffer} buffer
 * @returns {Date|null}
 */
function readExifDate(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return null; // kein JPEG (SOI-Marker fehlt)

    let offset = 2;
    const length = view.byteLength;

    while (offset < length) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break; // kein gültiger Marker mehr
      if (marker === 0xffda) break; // Start of Scan -> Bilddaten, EXIF wäre vorher gekommen

      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2) break; // ungültige Länge - würde sonst zur Endlosschleife führen

      if (marker === 0xffe1) {
        // APP1 kann EXIF ODER XMP sein. Steht das XMP-Paket VOR dem EXIF-Segment
        // (zulässig und bei manchen Werkzeugen üblich), darf hier nicht aufgegeben
        // werden - sonst gilt das Foto als "ohne Aufnahmedatum" und bekommt
        // stillschweigend das Dateidatum, was auch in den erzeugten Dateinamen
        // einfließt. Also: nur bei einem echten Treffer zurückkehren, sonst weitersuchen.
        const date = parseExifSegment(view, offset + 4);
        if (date) return date;
      }
      offset += 2 + segmentLength;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function parseExifSegment(view, start) {
  // Vollständigen "Exif\0\0"-Header prüfen (inkl. der zwei Nullbytes, sonst würde
  // z.B. ein APP1 mit anderem Präfix, das zufällig mit "Exif" beginnt, durchgehen).
  if (start + 6 > view.byteLength) return null;
  if (view.getUint32(start) !== 0x45786966) return null;
  if (view.getUint8(start + 4) !== 0x00 || view.getUint8(start + 5) !== 0x00) return null;
  const tiffStart = start + 6;
  const littleEndian = view.getUint16(tiffStart) === 0x4949;

  function u16(o) { return view.getUint16(o, littleEndian); }
  function u32(o) { return view.getUint32(o, littleEndian); }

  const firstIFDOffset = u32(tiffStart + 4);
  let exifIFDOffset = null;
  let dateTimeString = null;

  dateTimeString = scanIFD(tiffStart + firstIFDOffset, tiffStart, littleEndian, view,
    (tag) => tag === 0x8769, // Exif-Sub-IFD Pointer
    (tag) => tag === 0x0132  // DateTime (Fallback)
  );

  if (dateTimeString && dateTimeString.pointerTag) {
    exifIFDOffset = dateTimeString.pointerValue;
  }
  const fallbackDate = dateTimeString ? dateTimeString.dateStr : null;

  let preciseDate = null;
  if (exifIFDOffset != null) {
    const sub = scanIFD(tiffStart + exifIFDOffset, tiffStart, littleEndian, view,
      () => false,
      (tag) => tag === 0x9003 // DateTimeOriginal
    );
    if (sub && sub.dateStr) preciseDate = sub.dateStr;
  }

  const finalStr = preciseDate || fallbackDate;
  if (!finalStr) return null;
  return parseExifDateString(finalStr);
}

/**
 * Durchläuft ein IFD und sucht nach einem Pointer-Tag (z.B. Exif-SubIFD)
 * und/oder einem Datums-Tag. Gibt { pointerTag, pointerValue, dateStr } zurück.
 */
function scanIFD(ifdAbsOffset, tiffStart, littleEndian, view, isPointerTag, isDateTag) {
  function u16(o) { return view.getUint16(o, littleEndian); }
  function u32(o) { return view.getUint32(o, littleEndian); }

  const entryCount = u16(ifdAbsOffset);
  let result = { pointerTag: false, pointerValue: null, dateStr: null };

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdAbsOffset + 2 + i * 12;
    const tag = u16(entryOffset);
    const type = u16(entryOffset + 2);
    const count = u32(entryOffset + 4);
    const valueOffsetField = entryOffset + 8;

    if (isPointerTag(tag)) {
      result.pointerTag = true;
      result.pointerValue = u32(valueOffsetField);
    }

    if (isDateTag(tag) && type === 2) { // ASCII string
      // Werte <=4 Bytes liegen inline, sonst als Offset relativ zu tiffStart
      let strOffset;
      if (count <= 4) {
        strOffset = valueOffsetField;
      } else {
        strOffset = tiffStart + u32(valueOffsetField);
      }
      let str = "";
      for (let j = 0; j < count - 1; j++) { // -1: Null-Terminator auslassen
        const code = view.getUint8(strOffset + j);
        if (code === 0) break;
        str += String.fromCharCode(code);
      }
      result.dateStr = str;
    }
  }
  return result;
}

/**
 * EXIF-Datumsformat: "YYYY:MM:DD HH:MM:SS" -> Date
 */
function parseExifDateString(str) {
  const m = str.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (isNaN(date.getTime())) return null;
  return date;
}
