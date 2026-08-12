/**
 * Stichwort-Metadaten schreiben und lesen; Verifikation der Zieldatei.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

/* ============================================================
   STICHWORT-METADATEN SCHREIBEN (IPTC-IIM + XMP)
   ============================================================
   Sicherheitskonzept:
   1. Für JPEG wird der IPTC-IIM-Block direkt binär in die Datei geschrieben
      (APP13/Photoshop-IRB) sowie zusätzlich ein XMP-Paket (APP1) eingebettet.
      Alle anderen JPEG-Segmente (EXIF, ICC, etc.) und die Bilddaten selbst
      bleiben dabei byteidentisch erhalten (siehe jpeg-segments.js).
   2. Nach dem Schreiben wird die neu erzeugte Datei SOFORT wieder eingelesen
      und die Stichworte werden zurückgeprüft (Round-Trip-Konsistenz-Check),
      BEVOR sie das Ziel erreicht. Schlägt das fehl, wird auf die reine
      Sidecar-Variante zurückgefallen statt eine potenziell beschädigte
      Datei zu verwenden.
   3. Für alle Formate (auch JPEG zusätzlich) wird eine XMP-Sidecar-Datei
      (gleicher Name + .xmp) neben dem Foto abgelegt - das ist der garantiert
      sichere, formatunabhängige Weg, falls die Direkteinbettung nicht greift
      oder das Format (PNG, HEIC, RAW, ...) keine Direkteinbettung unterstützt.
   ============================================================ */

/** Dateiendungen, für die eine direkte binäre Einbettung der Stichworte versucht wird. */
const DIRECT_WRITE_EXTENSIONS = new Set(["jpg", "jpeg"]);

/**
 * Versucht, Stichworte UND optional eine Beschreibung direkt in eine JPEG-Datei
 * einzubetten (IPTC + XMP) und verifiziert das Ergebnis sofort durch
 * Zurücklesen. Bei jedem Fehler oder einer Inkonsistenz wird null zurückgegeben
 * (Aufrufer fällt dann auf die unveränderte Originaldatei + Sidecar zurück) -
 * es wird NIE eine Datei zurückgegeben, die nicht zuvor erfolgreich verifiziert wurde.
 *
 * @param {File} file - die zu bearbeitende Originaldatei
 * @param {string[]} keywords
 * @param {string} [description] - optionale Beschreibung (IPTC Caption/Abstract, XMP dc:description)
 * @returns {Promise<Uint8Array|null>}
 */
async function tryWriteKeywordsIntoJpeg(file, keywords, description) {
  try {
    const originalBuffer = new Uint8Array(await file.arrayBuffer());
    const deps = { buildIptcIimBlock, buildIrbForIptc, parseIrbs, buildXmpPacket };
    const written = writeKeywordsToJpeg(originalBuffer, keywords, deps, description);

    // Konsistenz-Check: sofort zurücklesen und mit den erwarteten Werten vergleichen.
    const verified = verifyWrittenJpegKeywords(written, keywords, description);
    if (!verified) {
      console.warn("Konsistenz-Check nach dem Schreiben fehlgeschlagen für", file.name, "- falle auf Sidecar-only zurück.");
      return null;
    }
    return written;
  } catch (e) {
    console.warn("Direktes Schreiben der Metadaten in JPEG fehlgeschlagen für", file.name, "-", e.message, "- falle auf Sidecar-only zurück.");
    return null;
  }
}

/**
 * Liest die Stichwort-Metadaten aus einem JPEG-Puffer: den IPTC-IIM-Block aus
 * dem Photoshop-IRB (APP13) und das XMP-Paket (APP1). Beide Rückgabewerte sind
 * null, wenn das jeweilige Segment fehlt - was der Normalfall für Fotos ist,
 * die noch nie verschlagwortet wurden.
 *
 * Eine Stelle für beides, weil dieselbe Zerlegung an drei Punkten gebraucht
 * wird: beim Konsistenz-Check nach dem Schreiben, bei der Prüfung der Zieldatei
 * vor dem Löschen der Quelle und beim Einlesen bereits vorhandener Stichworte.
 *
 * @param {Uint8Array} buffer
 * @returns {{iptc: {keywords: string[], description: string|null}|null,
 *            xmp: {keywords: string[], description: string|null}|null}}
 */
function readJpegMetadata(buffer) {
  const { segments } = parseJpegSegments(buffer);
  let iptc = null;
  let xmp = null;

  for (const seg of segments) {
    if (seg.marker === 0xed) {
      const prefix = readAsciiPrefix(buffer, seg.start + 4, PHOTOSHOP_PREAMBLE.length);
      if (prefix === PHOTOSHOP_PREAMBLE) {
        const irbBuffer = buffer.slice(seg.start + 4 + PHOTOSHOP_PREAMBLE.length, seg.end);
        for (const irb of parseIrbs(irbBuffer)) {
          if (irb.resourceId === 0x0404) iptc = parseIptcIimData(irb.data);
        }
      }
    } else if (seg.marker === 0xe1) {
      const prefix = readAsciiPrefix(buffer, seg.start + 4, XMP_PREAMBLE.length);
      if (prefix === XMP_PREAMBLE) {
        const xmpText = new TextDecoder("utf-8").decode(
          buffer.slice(seg.start + 4 + XMP_PREAMBLE.length, seg.end)
        );
        xmp = parseXmpData(xmpText);
      }
    }
  }
  return { iptc, xmp };
}

/**
 * Liefert die in einem Foto bereits vorhandenen Stichworte und die vorhandene
 * Beschreibung. XMP hat Vorrang vor IPTC: IPTC kürzt jedes Stichwort auf 64
 * Byte, XMP nicht - stehen beide in der Datei, ist die XMP-Fassung die
 * vollständigere. Gibt bei Formaten ohne Direkteinbettung oder bei
 * unlesbaren Dateien stillschweigend leere Werte zurück; ein Foto ohne
 * Metadaten ist der Normalfall, kein Fehler.
 *
 * @param {Uint8Array} buffer
 * @returns {{keywords: string[], description: string|null}}
 */
function readExistingKeywords(buffer) {
  try {
    const { iptc, xmp } = readJpegMetadata(buffer);
    const source = (xmp && xmp.keywords.length > 0) ? xmp : (iptc || xmp);
    if (!source) return { keywords: [], description: null };
    const keywords = [];
    for (const raw of source.keywords) {
      const k = typeof raw === "string" ? raw.trim() : "";
      // Dubletten fallen weg: dasselbe Stichwort in IPTC und XMP ist der
      // Regelfall, und der Nutzer soll es nicht doppelt angeboten bekommen.
      if (k && !keywords.includes(k)) keywords.push(k);
    }
    const description = source.description && source.description.trim() ? source.description.trim() : null;
    return { keywords, description };
  } catch (e) {
    return { keywords: [], description: null };
  }
}

/**
 * Liest eine gerade erzeugte JPEG-Bufferkopie erneut ein und prüft, ob die
 * IPTC- UND XMP-Stichworte SOWIE die Beschreibung exakt den erwarteten Werten
 * entsprechen. Nur wenn alles übereinstimmt, gilt der Schreibvorgang als sicher.
 */
function verifyWrittenJpegKeywords(writtenBuffer, expectedKeywords, expectedDescription) {
  const validExpected = expectedKeywords.map((k) => k.trim()).filter((k) => k.length > 0);
  const normalizedExpectedDesc = expectedDescription && expectedDescription.trim() ? expectedDescription.trim() : null;

  // IPTC kürzt jedes Stichwort auf MAX_KEYWORD_BYTES (Vorgabe der IIM-Spezifikation,
  // siehe buildIptcIimBlock). Für einen exakten Vergleich muss dieselbe Kürzung auf
  // den Erwartungswert angewendet werden - sonst schlägt der Konsistenz-Check bei
  // jedem längeren Stichwort fehl, obwohl korrekt geschrieben wurde. XMP kennt diese
  // Grenze nicht und wird deshalb gegen die UNGEKÜRZTEN Werte geprüft.
  const expectedIptcKeywords = validExpected.map((k) =>
    new TextDecoder("utf-8").decode(truncateUtf8(k, MAX_KEYWORD_BYTES))
  );

  try {
    const { iptc: iptcData, xmp: xmpData } = readJpegMetadata(writtenBuffer);

    const iptcKeywordsOk = iptcData && JSON.stringify(iptcData.keywords) === JSON.stringify(expectedIptcKeywords);
    const xmpKeywordsOk = xmpData && JSON.stringify(xmpData.keywords) === JSON.stringify(validExpected);

    // Für IPTC wird die Beschreibung ggf. auf MAX_CAPTION_BYTES gekürzt (siehe
    // buildIptcIimBlock) - für einen exakten Vergleich wird dieselbe Kürzung
    // hier auf den Erwartungswert angewendet, statt einer unsicheren Heuristik.
    const expectedIptcDescription = normalizedExpectedDesc
      ? new TextDecoder("utf-8").decode(truncateUtf8(normalizedExpectedDesc, MAX_CAPTION_BYTES))
      : null;
    const iptcDescOk = (iptcData ? iptcData.description : null) === expectedIptcDescription;
    const xmpDescOk = (xmpData ? xmpData.description : null) === normalizedExpectedDesc;

    return iptcKeywordsOk && xmpKeywordsOk && iptcDescOk && xmpDescOk;
  } catch (e) {
    return false;
  }
}

/**
 * Schreibt eine XMP-Sidecar-Datei (gleicher Basisname + .xmp) neben dem Zielfoto
 * in das übergebene Zielverzeichnis. Wird für ALLE Formate geschrieben (auch
 * JPEG zusätzlich zur Direkteinbettung) als formatunabhängiger, garantiert
 * sicherer Weg für Programme, die Sidecar-Dateien lesen.
 * @param {FileSystemDirectoryHandle} targetDirHandle
 * @param {string} photoBaseNameWithoutExt - Zieldateiname OHNE Endung
 * @param {string[]} keywords
 * @param {string} [description]
 */
async function writeXmpSidecar(targetDirHandle, photoBaseNameWithoutExt, keywords, description) {
  const xmpContent = buildXmpPacket(keywords, description);
  const sidecarName = `${photoBaseNameWithoutExt}.xmp`;
  const fileHandle = await targetDirHandle.getFileHandle(sidecarName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(xmpContent);
  await writable.close();
}

/**
 * Liest eine soeben geschriebene XMP-Sidecar-Datei frisch vom Dateisystem zurück
 * und prüft, ob Stichworte und Beschreibung den erwarteten Werten entsprechen.
 *
 * Für alle Formate ohne Direkteinbettung (PNG, HEIC, RAW, ...) ist die Sidecar-
 * Datei die EINZIGE Ablage der Metadaten. Sie vor dem irreversiblen Löschen der
 * Quelle ungeprüft zu lassen, wäre die Lücke in einer sonst lückenlosen Kette.
 *
 * @param {FileSystemDirectoryHandle} targetDirHandle
 * @param {string} photoBaseNameWithoutExt
 * @param {string[]} expectedKeywords
 * @param {string} [expectedDescription]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function verifySidecarFile(targetDirHandle, photoBaseNameWithoutExt, expectedKeywords, expectedDescription) {
  const sidecarName = `${photoBaseNameWithoutExt}.xmp`;
  try {
    const fileHandle = await targetDirHandle.getFileHandle(sidecarName);
    const text = await (await fileHandle.getFile()).text();
    const parsed = parseXmpData(text);

    const validExpected = expectedKeywords.map((k) => k.trim()).filter((k) => k.length > 0);
    if (JSON.stringify(parsed.keywords) !== JSON.stringify(validExpected)) {
      return { ok: false, reason: `Stichworte in „${sidecarName}" weichen ab` };
    }

    const normalizedExpectedDesc =
      expectedDescription && expectedDescription.trim() ? expectedDescription.trim() : null;
    if (parsed.description !== normalizedExpectedDesc) {
      return { ok: false, reason: `Beschreibung in „${sidecarName}" weicht ab` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `„${sidecarName}" konnte nicht zur Prüfung gelesen werden: ${e.message}` };
  }
}

/* ============================================================
   SICHERHEIT: VERIFIKATION DER ZIELDATEI VOR DEM LÖSCHEN DER QUELLE
   ============================================================
   Nach dem Schreiben ins Ziel wird die neu erzeugte Datei erneut vom
   Dateisystem gelesen (nicht aus dem Speicher übernommen) und geprüft, bevor
   die Quelldatei gelöscht wird. Da sich Ziel- und Quelldatei durch Umbenennung
   und ggf. eingebettete Metadaten unterscheiden, wird NICHT byteweise mit der
   Quelle verglichen. Stattdessen:
   1) Größe: Ziel muss exakt der Größe des Inhalts entsprechen, der geschrieben
      werden sollte (bekannt aus dem Schreibvorgang selbst).
   2) Bilddaten-Hash: Bei JPEG bleibt der Bildanteil (ab dem Start-of-Scan-
      Marker) durch das Metadaten-Schreiben garantiert unverändert (siehe
      jpeg-segments.js) - dessen SHA-256-Hash muss exakt dem der Quelle
      entsprechen. Bei allen anderen Formaten (keine Metadaten-Manipulation)
      muss der Hash der KOMPLETTEN Datei exakt der Quelle entsprechen.
   3) Metadaten: falls Stichworte/Beschreibung geschrieben werden sollten,
      werden sie aus der neu gelesenen Zieldatei zurückgelesen und verglichen
      (dieselbe Prüfung wie beim Schreiben selbst, hier zusätzlich als letzte
      Instanz direkt vor dem irreversiblen Löschen der Quelle).
   ============================================================ */

/** Berechnet den SHA-256-Hash eines Byte-Bereichs als Hex-String. */
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Liefert den Byte-Bereich einer Datei, der für den Integritäts-Vergleich
 * herangezogen wird: bei JPEG nur die Bilddaten (ab Start-of-Scan, die vom
 * Metadaten-Schreiben nicht berührt werden), sonst die komplette Datei.
 */
function getComparableImageBytes(buffer, ext) {
  if (DIRECT_WRITE_EXTENSIONS.has(ext)) {
    try {
      const { scanStart } = parseJpegSegments(buffer);
      return buffer.slice(scanStart);
    } catch (e) {
      // Kein gültiges/parsbares JPEG (sollte nicht vorkommen, da wir es ggf.
      // selbst geschrieben haben) - sicherheitshalber die komplette Datei nehmen.
      return buffer;
    }
  }
  return buffer;
}

/**
 * Verifiziert, dass eine soeben ins Ziel geschriebene Datei tatsächlich
 * vollständig und unbeschädigt auf dem Dateisystem liegt, BEVOR die Quelle
 * gelöscht werden darf. Liest die Zieldatei aktiv neu vom Dateisystem ein
 * (kein Vertrauen auf den zuvor im Speicher gehaltenen Inhalt).
 *
 * @param {FileSystemDirectoryHandle} targetDirHandle
 * @param {string} targetFileName
 * @param {Uint8Array|File} expectedContent - was tatsächlich geschrieben werden sollte
 * @param {string} ext - Dateiendung der Quelle (für JPEG-Sonderbehandlung)
 * @param {string[]|null} [expectedKeywords] - nur setzen, wenn die Metadaten
 *   tatsächlich in die Datei EINGEBETTET wurden. Beim Sidecar-Fallback muss hier
 *   null stehen, sonst würden in der Zieldatei Metadaten erwartet, die dort
 *   erwartungsgemäß gar nicht stehen.
 * @param {string|null} [expectedDescription] - dito
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function verifyMovedFile(targetDirHandle, targetFileName, expectedContent, ext, expectedKeywords, expectedDescription) {
  try {
    const expectedBytes = expectedContent instanceof Uint8Array
      ? expectedContent
      : new Uint8Array(await expectedContent.arrayBuffer());

    // Datei aktiv neu vom Dateisystem lesen - nicht den Handle wiederverwenden,
    // an dem gerade geschrieben wurde, sondern frisch über den Ordner auflösen.
    const readBackHandle = await targetDirHandle.getFileHandle(targetFileName);
    const readBackFile = await readBackHandle.getFile();

    // 1) Größenprüfung (schnelle Vorprüfung)
    if (readBackFile.size !== expectedBytes.length) {
      return { ok: false, reason: `Größe weicht ab (Ziel: ${readBackFile.size} Bytes, erwartet: ${expectedBytes.length} Bytes)` };
    }

    const readBackBytes = new Uint8Array(await readBackFile.arrayBuffer());

    // 2) Bilddaten-Integrität per Hash (bei JPEG nur der garantiert unveränderte
    //    Bildanteil, sonst die komplette Datei)
    const expectedImageBytes = getComparableImageBytes(expectedBytes, ext);
    const readBackImageBytes = getComparableImageBytes(readBackBytes, ext);
    const expectedHash = await sha256Hex(expectedImageBytes);
    const readBackHash = await sha256Hex(readBackImageBytes);
    if (expectedHash !== readBackHash) {
      return { ok: false, reason: "Bilddaten-Prüfsumme stimmt nicht überein (mögliche Beschädigung beim Schreiben)" };
    }

    // 3) Metadaten-Verifikation, falls welche geschrieben werden sollten und es
    //    sich um ein Format mit Direkteinbettung handelt (sonst ist die
    //    Sidecar-Datei die einzige Quelle, die wird hier nicht erneut geprüft,
    //    da sie bereits beim Schreiben selbst verifiziert wurde).
    if (DIRECT_WRITE_EXTENSIONS.has(ext) && (expectedKeywords?.length > 0 || expectedDescription)) {
      const metaOk = verifyWrittenJpegKeywords(readBackBytes, expectedKeywords || [], expectedDescription);
      if (!metaOk) {
        return { ok: false, reason: "Metadaten (Stichworte/Beschreibung) in der Zieldatei stimmen nicht mit den erwarteten Werten überein" };
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Zieldatei konnte nicht zur Prüfung gelesen werden: ${e.message}` };
  }
}
