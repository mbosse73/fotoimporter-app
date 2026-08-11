/**
 * Erweiterter EXIF-Parser für die Info-Anzeige (Leuchttisch/Grid-Overlay).
 * Ergänzt exif.js (das nur das Aufnahmedatum liest) um weitere Felder:
 * Kamera-Hersteller/Modell, Belichtungszeit, Blende, ISO, Brennweite, Blitz,
 * Weißabgleich, GPS-Koordinaten, Bildabmessungen.
 *
 * Bewusst als separates Modul, um exif.js (wird für die Sortierung nach
 * Aufnahmedatum verwendet) nicht anzufassen und keine Regression zu riskieren.
 */

const EXIF_TAG_MAKE = 0x010f;
const EXIF_TAG_MODEL = 0x0110;
const EXIF_TAG_EXIF_IFD_POINTER = 0x8769;
const EXIF_TAG_GPS_IFD_POINTER = 0x8825;
const EXIF_TAG_EXPOSURE_TIME = 0x829a;
const EXIF_TAG_FNUMBER = 0x829d;
const EXIF_TAG_ISO = 0x8827;
const EXIF_TAG_FOCAL_LENGTH = 0x920a;
const EXIF_TAG_FOCAL_LENGTH_35MM = 0xa405;
const EXIF_TAG_FLASH = 0x9209;
const EXIF_TAG_WHITE_BALANCE = 0xa403;
const EXIF_TAG_PIXEL_X = 0xa002;
const EXIF_TAG_PIXEL_Y = 0xa003;
const EXIF_TAG_LENS_MODEL = 0xa434;

const GPS_TAG_LAT_REF = 0x0001;
const GPS_TAG_LAT = 0x0002;
const GPS_TAG_LON_REF = 0x0003;
const GPS_TAG_LON = 0x0004;
const GPS_TAG_ALTITUDE_REF = 0x0005;
const GPS_TAG_ALTITUDE = 0x0006;

const FLASH_LABELS = {
  0x0: "Nicht ausgelöst",
  0x1: "Ausgelöst",
  0x5: "Ausgelöst, kein Rücklicht erkannt",
  0x7: "Ausgelöst, Rücklicht erkannt",
  0x8: "Nicht ausgelöst, Zwangsmodus",
  0x9: "Ausgelöst, Zwangsmodus",
  0x10: "Nicht ausgelöst, Automatikmodus",
  0x18: "Nicht ausgelöst, kein Blitz vorhanden",
  0x19: "Ausgelöst, Automatikmodus",
};
const WHITE_BALANCE_LABELS = { 0: "Automatisch", 1: "Manuell" };

/**
 * Liest ein erweitertes Set an EXIF-Feldern aus einem JPEG-ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Object|null} Objekt mit allen gefundenen Feldern (fehlende Felder sind undefined), oder null falls keine EXIF-Daten vorhanden sind.
 */
function readExtendedExif(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    const length = view.byteLength;
    while (offset < length) {
      const marker = view.getUint16(offset);
      if (marker === 0xffe1) return parseExtendedExifSegment(view, offset + 4);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffda) break;
      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function parseExtendedExifSegment(view, start) {
  if (view.getUint32(start) !== 0x45786966) return null; // "Exif"
  const tiffStart = start + 6;
  const littleEndian = view.getUint16(tiffStart) === 0x4949;

  function u16(o) { return view.getUint16(o, littleEndian); }
  function u32(o) { return view.getUint32(o, littleEndian); }
  function i32(o) { return view.getInt32(o, littleEndian); }

  const result = {};
  const firstIFDOffset = u32(tiffStart + 4);

  // IFD0: Make, Model, Pointer zu Exif-SubIFD und GPS-IFD
  const ifd0 = readIfdEntries(view, tiffStart + firstIFDOffset, tiffStart, littleEndian);
  applyStringField(result, "make", ifd0, EXIF_TAG_MAKE, view, tiffStart, littleEndian);
  applyStringField(result, "model", ifd0, EXIF_TAG_MODEL, view, tiffStart, littleEndian);

  const exifIfdEntry = ifd0.get(EXIF_TAG_EXIF_IFD_POINTER);
  const gpsIfdEntry = ifd0.get(EXIF_TAG_GPS_IFD_POINTER);

  if (exifIfdEntry) {
    const subIfd = readIfdEntries(view, tiffStart + exifIfdEntry.rawValue, tiffStart, littleEndian);

    applyRationalField(result, "exposureTime", subIfd, EXIF_TAG_EXPOSURE_TIME, view, tiffStart, littleEndian);
    applyRationalField(result, "fNumber", subIfd, EXIF_TAG_FNUMBER, view, tiffStart, littleEndian);
    applyRationalField(result, "focalLength", subIfd, EXIF_TAG_FOCAL_LENGTH, view, tiffStart, littleEndian);

    const isoEntry = subIfd.get(EXIF_TAG_ISO);
    if (isoEntry) result.iso = isoEntry.rawValue;

    const focal35Entry = subIfd.get(EXIF_TAG_FOCAL_LENGTH_35MM);
    if (focal35Entry) result.focalLength35mm = focal35Entry.rawValue;

    const flashEntry = subIfd.get(EXIF_TAG_FLASH);
    if (flashEntry) result.flash = flashEntry.rawValue;

    const wbEntry = subIfd.get(EXIF_TAG_WHITE_BALANCE);
    if (wbEntry) result.whiteBalance = wbEntry.rawValue;

    const pxEntry = subIfd.get(EXIF_TAG_PIXEL_X);
    if (pxEntry) result.pixelWidth = pxEntry.rawValue;
    const pyEntry = subIfd.get(EXIF_TAG_PIXEL_Y);
    if (pyEntry) result.pixelHeight = pyEntry.rawValue;

    applyStringField(result, "lensModel", subIfd, EXIF_TAG_LENS_MODEL, view, tiffStart, littleEndian);
  }

  if (gpsIfdEntry) {
    const gpsIfd = readIfdEntries(view, tiffStart + gpsIfdEntry.rawValue, tiffStart, littleEndian);
    const lat = readGpsCoordinate(gpsIfd, GPS_TAG_LAT, GPS_TAG_LAT_REF, view, tiffStart, littleEndian, "S");
    const lon = readGpsCoordinate(gpsIfd, GPS_TAG_LON, GPS_TAG_LON_REF, view, tiffStart, littleEndian, "W");
    if (lat != null) result.gpsLatitude = lat;
    if (lon != null) result.gpsLongitude = lon;

    const altEntry = gpsIfd.get(GPS_TAG_ALTITUDE);
    if (altEntry) {
      const altOffset = tiffStart + view.getUint32(altEntry.valueOffsetField, littleEndian);
      const altValue = readRationalPair(view, altOffset, littleEndian);
      const refEntry = gpsIfd.get(GPS_TAG_ALTITUDE_REF);
      const belowSea = refEntry && view.getUint8(refEntry.valueOffsetField) === 1;
      if (altValue != null) result.gpsAltitude = belowSea ? -altValue : altValue;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Liest alle Einträge eines IFD in eine Map (Tag -> { type, count, valueOffsetField, rawValue }).
 * rawValue ist bei numerischen Kurz-Werten (die direkt ins 4-Byte-Feld passen) bereits
 * aufgelöst; bei Strings/Rationals muss man valueOffsetField zusätzlich selbst auswerten.
 */
function readIfdEntries(view, ifdAbsOffset, tiffStart, littleEndian) {
  const map = new Map();
  try {
    function u16(o) { return view.getUint16(o, littleEndian); }
    function u32(o) { return view.getUint32(o, littleEndian); }

    const entryCount = u16(ifdAbsOffset);
    for (let i = 0; i < entryCount; i++) {
      const entryOffset = ifdAbsOffset + 2 + i * 12;
      const tag = u16(entryOffset);
      const type = u16(entryOffset + 2);
      const count = u32(entryOffset + 4);
      const valueOffsetField = entryOffset + 8;

      let rawValue = null;
      if (type === 3 && count === 1) rawValue = view.getUint16(valueOffsetField, littleEndian); // SHORT
      else if (type === 4 && count === 1) rawValue = u32(valueOffsetField); // LONG (auch für IFD-Pointer)
      else if (type === 9 && count === 1) rawValue = view.getInt32(valueOffsetField, littleEndian); // SLONG

      map.set(tag, { type, count, valueOffsetField, rawValue });
    }
  } catch (e) {
    // unvollständiges/beschädigtes IFD - bisher gesammelte Einträge trotzdem zurückgeben
  }
  return map;
}

function applyStringField(result, key, ifdMap, tag, view, tiffStart, littleEndian) {
  const entry = ifdMap.get(tag);
  if (!entry || entry.type !== 2) return; // Typ 2 = ASCII
  const strOffset = entry.count <= 4 ? entry.valueOffsetField : tiffStart + view.getUint32(entry.valueOffsetField, littleEndian);
  let str = "";
  for (let j = 0; j < entry.count - 1; j++) {
    const code = view.getUint8(strOffset + j);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  if (str.trim()) result[key] = str.trim();
}

function applyRationalField(result, key, ifdMap, tag, view, tiffStart, littleEndian) {
  const entry = ifdMap.get(tag);
  if (!entry || entry.type !== 5) return; // Typ 5 = RATIONAL (unsigned)
  const rationalOffset = tiffStart + view.getUint32(entry.valueOffsetField, littleEndian);
  const numerator = view.getUint32(rationalOffset, littleEndian);
  const denominator = view.getUint32(rationalOffset + 4, littleEndian);
  if (denominator !== 0) result[key] = numerator / denominator;
}

/** Liest eine GPS-Koordinate (3 Rationals: Grad, Minuten, Sekunden) und wandelt sie in Dezimalgrad um. */
function readGpsCoordinate(gpsIfd, valueTag, refTag, view, tiffStart, littleEndian, negativeRefChar) {
  const valueEntry = gpsIfd.get(valueTag);
  const refEntry = gpsIfd.get(refTag);
  if (!valueEntry) return null;
  try {
    const dataOffset = tiffStart + view.getUint32(valueEntry.valueOffsetField, littleEndian);
    const degrees = readRationalPair(view, dataOffset, littleEndian);
    const minutes = readRationalPair(view, dataOffset + 8, littleEndian);
    const seconds = readRationalPair(view, dataOffset + 16, littleEndian);
    if (degrees == null || minutes == null || seconds == null) return null;

    let decimal = degrees + minutes / 60 + seconds / 3600;

    if (refEntry) {
      const refChar = String.fromCharCode(view.getUint8(refEntry.valueOffsetField));
      if (refChar === negativeRefChar) decimal = -decimal;
    }
    return decimal;
  } catch (e) {
    return null;
  }
}

function readRationalPair(view, offset, littleEndian) {
  const numerator = view.getUint32(offset, littleEndian);
  const denominator = view.getUint32(offset + 4, littleEndian);
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/* ============================================================
   FORMATIERUNG FÜR DIE ANZEIGE
   ============================================================ */

/** Formatiert die Belichtungszeit als Bruch (z.B. "1/250 s") oder in Sekunden bei langen Zeiten. */
function formatExposureTime(seconds) {
  if (seconds == null) return null;
  if (seconds >= 1) return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)} s`;
  const denominator = Math.round(1 / seconds);
  return `1/${denominator} s`;
}

function formatFNumber(f) {
  if (f == null) return null;
  return `f/${f % 1 === 0 ? f : f.toFixed(1)}`;
}

function formatFocalLength(mm, mm35) {
  if (mm == null) return null;
  let str = `${Math.round(mm)} mm`;
  if (mm35 != null && Math.round(mm35) !== Math.round(mm)) str += ` (${Math.round(mm35)} mm ¹)`;
  return str;
}

function formatIso(iso) {
  if (iso == null) return null;
  return `ISO ${iso}`;
}

function formatFlash(code) {
  if (code == null) return null;
  return FLASH_LABELS[code] || `Code ${code}`;
}

function formatWhiteBalance(code) {
  if (code == null) return null;
  return WHITE_BALANCE_LABELS[code] || `Code ${code}`;
}

function formatGpsCoordinate(lat, lon) {
  if (lat == null || lon == null) return null;
  const latStr = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "O" : "W"}`;
  return `${latStr}, ${lonStr}`;
}

function formatDimensions(w, h) {
  if (!w || !h) return null;
  return `${w} × ${h} px`;
}

if (typeof module !== "undefined") {
  module.exports = {
    readExtendedExif,
    formatExposureTime,
    formatFNumber,
    formatFocalLength,
    formatIso,
    formatFlash,
    formatWhiteBalance,
    formatGpsCoordinate,
    formatDimensions,
  };
}
