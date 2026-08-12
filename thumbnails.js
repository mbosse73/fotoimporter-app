/**
 * Vorschaubilder: Lazy Loading, Groessencache, RAW-Vorschau.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

/* ============================================================
   THUMBNAILS – LAZY LOADING PER INTERSECTION OBSERVER
   (nur sichtbare/nahe Zellen laden ihr Bild -> entlastet Start und
   Navigation massiv bei vielen hundert/tausend Fotos)
   ============================================================ */

let thumbnailLoadGeneration = 0;
let thumbObserver = null;
const thumbLoadQueue = [];
let thumbLoadInFlight = 0;
const THUMB_CONCURRENCY = 4;

function resetThumbnailLoading() {
  thumbnailLoadGeneration++;
  thumbLoadQueue.length = 0;
  thumbLoadInFlight = 0;
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(onThumbIntersect, {
    root: document.getElementById("gridWrap"),
    rootMargin: "600px 0px", // etwas außerhalb des Viewports schon vorladen
  });
}

/**
 * Gibt alle Object-URLs (Grid-Thumbnails und Lightbox-Großvorschauen) der
 * übergebenen Fotos frei. Muss vor dem Verwerfen einer Fotoliste aufgerufen
 * werden (neuer Ordner, o. Ä.), sonst sammelt der Browser über mehrere
 * Ordnerwechsel hinweg ungenutzte Bild-Blobs im Speicher an.
 */
function revokePhotoObjectUrls(photos) {
  for (const entry of photos) {
    if (entry.thumbUrl && entry.thumbUrl.startsWith("blob:")) {
      URL.revokeObjectURL(entry.thumbUrl);
    }
    releaseLargePreviews(entry);
    forgetLargePreview(entry);
  }
}

/* ------------------------------------------------------------
   GROSSVORSCHAUEN: BEGRENZTER CACHE (LRU)
   ------------------------------------------------------------
   largePreviewUrl (bis 1600px) und fullResUrl (Lupe, bis 6000px) sind um ein
   Vielfaches größer als die Grid-Thumbnails. Ohne Obergrenze bleibt jede einmal
   im Leuchttisch besuchte Vorschau bis zum Ordnerwechsel im Speicher - bei einem
   Kameraordner mit vierstelliger Fotozahl ist das der wahrscheinlichste Weg in
   einen zähen oder abstürzenden Tab. Deshalb: nur die zuletzt benutzten Fotos
   behalten, ältere Vorschauen freigeben. Sie werden bei Bedarf neu erzeugt.
   Die kleinen Grid-Thumbnails sind davon nicht betroffen.
   ------------------------------------------------------------ */

const LARGE_PREVIEW_CACHE_SIZE = 20;
const largePreviewLru = []; // PhotoEntry-Referenzen, älteste zuerst

/** Gibt die großen Vorschau-URLs eines Fotos frei (Thumbnail bleibt erhalten). */
function releaseLargePreviews(entry) {
  if (entry.largePreviewUrl && entry.largePreviewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(entry.largePreviewUrl);
  }
  if (entry.fullResUrl && entry.fullResUrl.startsWith("blob:")) {
    URL.revokeObjectURL(entry.fullResUrl);
  }
  entry.largePreviewUrl = null;
  entry.fullResUrl = null;
}

/** Entfernt ein Foto aus der LRU-Liste, ohne etwas freizugeben. */
function forgetLargePreview(entry) {
  const pos = largePreviewLru.indexOf(entry);
  if (pos !== -1) largePreviewLru.splice(pos, 1);
}

/**
 * Meldet ein Foto als "gerade benutzt" und gibt die Vorschauen des ältesten
 * Fotos frei, sobald die Obergrenze überschritten ist. Da das aktuell angezeigte
 * Foto immer das zuletzt benutzte ist, kann es nie selbst verdrängt werden.
 */
function touchLargePreview(entry) {
  forgetLargePreview(entry);
  largePreviewLru.push(entry);
  while (largePreviewLru.length > LARGE_PREVIEW_CACHE_SIZE) {
    releaseLargePreviews(largePreviewLru.shift());
  }
}

function onThumbIntersect(entriesObserved) {
  for (const obs of entriesObserved) {
    if (!obs.isIntersecting) continue;
    const index = Number(obs.target.dataset.index);
    thumbObserver.unobserve(obs.target); // nur einmal anfragen
    enqueueThumbLoad(index);
  }
}

function enqueueThumbLoad(index) {
  const entry = state.photos[index];
  if (!entry || entry.thumbUrl || entry.thumbFailed) return;
  thumbLoadQueue.push(index);
  pumpThumbQueue();
}

function pumpThumbQueue() {
  const myGeneration = thumbnailLoadGeneration;
  while (thumbLoadInFlight < THUMB_CONCURRENCY && thumbLoadQueue.length > 0) {
    const index = thumbLoadQueue.shift();
    thumbLoadInFlight++;
    loadOneThumbnail(index, myGeneration).finally(() => {
      thumbLoadInFlight--;
      if (myGeneration === thumbnailLoadGeneration) pumpThumbQueue();
    });
  }
}

async function loadOneThumbnail(index, myGeneration) {
  if (myGeneration !== thumbnailLoadGeneration) return;
  const entry = state.photos[index];
  if (!entry || entry.thumbUrl || entry.thumbFailed) return;
  try {
    if (RAW_EXTENSIONS.has(entry.ext)) {
      const file = await entry.handle.getFile();
      if (myGeneration !== thumbnailLoadGeneration) return;
      const preview = await extractRawPreviewBlob(file);
      if (myGeneration !== thumbnailLoadGeneration) return;
      if (!preview) {
        entry.thumbFailed = true; // RAW ohne auffindbare Vorschau -> grauer Kasten
      } else {
        const objectUrl = await downscaleImageToObjectUrl(preview, 320);
        if (myGeneration !== thumbnailLoadGeneration) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        entry.thumbUrl = objectUrl;
      }
    } else if (THUMBNAILABLE_EXTENSIONS.has(entry.ext)) {
      const file = await entry.handle.getFile();
      if (myGeneration !== thumbnailLoadGeneration) return;
      // Echtes kleines Thumbnail erzeugen (Canvas-Downscale), statt die Originaldatei
      // (oft mehrere MB, mehrere tausend Pixel Kantenlänge) direkt als img.src zu
      // verwenden. Das Dekodieren/Rastern voller Kamerabilder für eine 150px-Kachel
      // ist der Haupttäter für Ruckeln bei der Navigation, da beim Zeilenwechsel
      // (Pfeil hoch/runter) mehrere solcher Bilder gleichzeitig sichtbar werden.
      const objectUrl = await downscaleImageToObjectUrl(file, 320);
      if (myGeneration !== thumbnailLoadGeneration) {
        URL.revokeObjectURL(objectUrl); // Ordner hat inzwischen gewechselt - nicht liegen lassen
        return;
      }
      entry.thumbUrl = objectUrl;
    } else {
      entry.thumbFailed = true; // Format ohne darstellbare Vorschau -> grauer Kasten
    }
  } catch (e) {
    // Fallback: falls Downscaling scheitert (z.B. HEIC vom Browser nicht decodierbar),
    // Originaldatei direkt verwenden statt komplett auf "keine Vorschau" zu gehen.
    // Für RAW ergibt das keinen Sinn - der Browser kann die Datei nicht anzeigen,
    // es bliebe ein kaputtes Bildsymbol statt des ehrlichen "keine Vorschau".
    if (RAW_EXTENSIONS.has(entry.ext)) {
      entry.thumbFailed = true;
      if (myGeneration === thumbnailLoadGeneration) updateCellThumb(index);
      return;
    }
    try {
      const file = await entry.handle.getFile();
      // Auch hier die Generation prüfen: ohne diese Abfrage hinge die URL an einem
      // bereits verworfenen Eintrag und würde nie wieder freigegeben.
      if (myGeneration !== thumbnailLoadGeneration) return;
      entry.thumbUrl = URL.createObjectURL(file);
    } catch (e2) {
      entry.thumbFailed = true;
    }
  }
  if (myGeneration === thumbnailLoadGeneration) updateCellThumb(index);
}

/* ------------------------------------------------------------
   RAW-VORSCHAU (F7)
   ------------------------------------------------------------
   raw-preview.js sagt, WO in der Datei ein eingebettetes JPEG liegt; hier wird
   daraus ein Blob. Die Trennung hat einen praktischen Grund: RAW-Dateien sind
   oft 30-60 MB groß. Für die Strukturanalyse genügt der Dateianfang, und das
   eigentliche Vorschaubild wird anschließend als schmaler Ausschnitt geholt -
   statt für jede Kachel im Grid die komplette Datei in den Speicher zu laden.
   ------------------------------------------------------------ */

/** Wie viel vom Dateianfang für die Strukturanalyse gelesen wird. */
const RAW_HEADER_BYTES = 256 * 1024;
/** Wie weit die Byte-Suche als Rückfallweg maximal reicht. */
const RAW_SCAN_BYTES = 8 * 1024 * 1024;
/** Wie viele Kandidaten höchstens durchprobiert werden, bevor aufgegeben wird. */
const RAW_MAX_CANDIDATES = 4;

/**
 * Schneidet aus einer RAW-Datei das eingebettete Vorschau-JPEG heraus.
 * Probiert die gefundenen Bereiche der Größe nach durch und liefert den ersten,
 * der sich tatsächlich decodieren lässt - ein Bereich kann strukturell richtig
 * aussehen und trotzdem kein brauchbares Bild enthalten.
 *
 * @param {File} file
 * @returns {Promise<Blob|null>} null, wenn keine Vorschau gefunden wurde
 */
async function extractRawPreviewBlob(file) {
  const headerBytes = new Uint8Array(await file.slice(0, RAW_HEADER_BYTES).arrayBuffer());
  let candidates = findEmbeddedJpegRanges(headerBytes, file.size);

  if (candidates.length === 0) {
    // Rückfallweg: im Dateianfang nach JPEG-Marken suchen. Bewusst begrenzt -
    // die eingebettete Vorschau liegt bei allen bekannten Formaten vorne, und
    // eine 60-MB-Datei komplett zu durchsuchen wäre pro Kachel zu teuer.
    const scanBytes = file.size <= RAW_SCAN_BYTES
      ? new Uint8Array(await file.arrayBuffer())
      : new Uint8Array(await file.slice(0, RAW_SCAN_BYTES).arrayBuffer());
    candidates = scanForJpegRanges(scanBytes, 0);
  }

  for (const candidate of candidates.slice(0, RAW_MAX_CANDIDATES)) {
    const blob = file.slice(candidate.offset, candidate.offset + candidate.length, "image/jpeg");
    try {
      // createImageBitmap ist hier gleichzeitig die Prüfung: was sich decodieren
      // lässt, ist ein Bild. Der Bitmap selbst wird nicht gebraucht - der Aufrufer
      // skaliert den Blob ohnehin noch herunter.
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      return blob;
    } catch (e) {
      // Nächster Kandidat.
    }
  }
  return null;
}

/**
 * Skaliert eine Bilddatei auf eine kleine Kantenlänge herunter und liefert das
 * Ergebnis als Object-URL (blob:) – sparsamer im Speicher als eine Data-URL,
 * da der Browser die Bilddaten nicht als Base64-String im Zugriff hält.
 * Nutzt createImageBitmap (läuft off-thread, blockiert den Hauptthread nicht
 * beim Decodieren) statt eines <img>-Elements.
 */
async function downscaleImageToObjectUrl(file, maxEdge) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    // JPEG-Encoding ist deutlich kompakter als PNG für Fotos und reicht für Thumbnails.
    return await canvasToObjectUrl(canvas);
  } finally {
    bitmap.close(); // Speicher des dekodierten Vollbilds sofort freigeben
  }
}

function canvasToObjectUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("toBlob fehlgeschlagen")); return; }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.82
    );
  });
}

function updateCellThumb(index) {
  const cell = cellElements[index];
  if (!cell) return;
  const entry = state.photos[index];
  const box = cell.thumbBox;
  if (entry.thumbUrl) {
    box.innerHTML = "";
    const img = document.createElement("img");
    img.src = entry.thumbUrl;
    img.loading = "lazy";
    img.alt = entry.name;
    box.appendChild(img);
  } else if (entry.thumbFailed) {
    box.innerHTML = `<div class="noThumb">Keine<br>Vorschau<br>${escapeHtml(entry.ext.toUpperCase())}</div>`;
  }
}
