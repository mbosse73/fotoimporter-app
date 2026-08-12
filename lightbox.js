/**
 * Leuchttisch: Anzeige, EXIF-Overlay, Lupe, Seitenpanel, Filmstreifen.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

/* ============================================================
   LEUCHTKASTEN (LIGHTBOX)
   ============================================================ */

const lightboxEl = document.getElementById("lightbox");
let lightboxIndex = -1;

function openLightbox(index) {
  if (state.photos.length === 0) return;
  closeGridExifOverlay(); // Grid-Overlay ist hinter dem Leuchtkasten nicht sichtbar, sauber schließen statt "geisterhaft" offen zu lassen
  lightboxIndex = index;
  lightboxEl.classList.remove("hidden");
  applyLightboxPanelVisibility();
  lightboxExifVisible = false;
  applyLightboxExifVisibility();
  loupeActive = false;
  applyLoupeVisibility();
  renderLightbox();
  document.addEventListener("keydown", onLightboxKeydown, true);
}

function closeLightbox() {
  lightboxEl.classList.add("hidden");
  document.removeEventListener("keydown", onLightboxKeydown, true);
  loupeActive = false;
  applyLoupeVisibility();
  // Grid-Cursor auf das zuletzt im Leuchtkasten gezeigte Foto setzen, Grid aktualisieren
  setCursor(lightboxIndex, true);
  updateBottomBar();
  gridWrap.focus();
}

// Ein einziges <img>-Element wird wiederverwendet: nur das src wechseln vermeidet
// DOM-Neuaufbau (kein innerHTML-Reset) und macht das Blättern im Leuchtkasten spürbar flüssiger.
let lightboxImgEl = null;
let lightboxPlaceholderEl = null;

function ensureLightboxImgEl() {
  const wrap = document.getElementById("lightboxImgWrap");
  if (!lightboxImgEl) {
    lightboxImgEl = document.createElement("img");
    lightboxImgEl.alt = "";
    wrap.appendChild(lightboxImgEl);
  }
  if (!lightboxPlaceholderEl) {
    lightboxPlaceholderEl = document.createElement("div");
    lightboxPlaceholderEl.className = "noThumbLarge";
    wrap.appendChild(lightboxPlaceholderEl);
  }
}

async function renderLightbox() {
  const entry = state.photos[lightboxIndex];
  document.getElementById("lbFilename").textContent = photoDisplayName(entry);
  document.getElementById("lbIndex").textContent = `${lightboxIndex + 1} / ${state.photos.length}`;

  ensureLightboxImgEl();
  await showLightboxImage(entry);

  const badge = document.getElementById("lightboxCurrentBadge");
  badge.className = "";
  if (entry.action === "move") {
    badge.classList.add("action-move");
    badge.textContent = "Markiert: Verschieben";
  } else if (entry.action === "delete") {
    badge.classList.add("action-delete");
    badge.textContent = "Markiert: Löschen";
  } else {
    badge.classList.add("action-none");
    badge.textContent = "Keine Aktion";
  }

  document.getElementById("lbMoveBtn").classList.toggle("active-move", entry.action === "move");
  document.getElementById("lbDeleteBtn").classList.toggle("active-delete", entry.action === "delete");

  renderLightboxKeywordOverlay(entry);
  renderLightboxPanel();
  renderFilmstrip();
  renderLightboxExifOverlay();
  refreshLoupeForCurrentPhoto();

  preloadNeighborThumbnails(lightboxIndex);
}

/** Zeigt die zugewiesenen Stichworte direkt über dem Bild an - auch sichtbar, wenn das Seitenpanel ausgeblendet ist. */
function renderLightboxKeywordOverlay(entry) {
  const overlay = document.getElementById("lightboxKwOverlay");
  overlay.innerHTML = entry.assignedKeywords
    .map((label) => `<span class="lbOverlayChip">${escapeHtml(label)}</span>`)
    .join("");
}

/* ============================================================
   EXIF-INFO-OVERLAY (Leuchtkasten + Grid)
   ============================================================
   Zeigt Kamera, Belichtung, GPS und Bildabmessungen als dezentes,
   halbtransparentes Panel. Die erweiterten EXIF-Daten werden bei Bedarf
   einmalig von der Datei gelesen und direkt am PhotoEntry gecacht
   (entry.extendedExif), damit wiederholtes Ein-/Ausblenden nicht jedes Mal
   erneut von der Platte liest.
   ============================================================ */

let lightboxExifVisible = false;
let gridExifVisible = false;

/** Liest (mit Cache am PhotoEntry) die erweiterten EXIF-Daten eines Fotos. */
async function getExtendedExifForEntry(entry) {
  if (entry.extendedExif !== undefined) return entry.extendedExif; // bereits gelesen (auch null zählt als "gelesen")
  if (entry.ext !== "jpg" && entry.ext !== "jpeg") {
    entry.extendedExif = null;
    return null;
  }
  try {
    const file = await entry.handle.getFile();
    const buf = await file.arrayBuffer();
    entry.extendedExif = readExtendedExif(buf);
  } catch (e) {
    entry.extendedExif = null;
  }
  return entry.extendedExif;
}

/**
 * Baut das innere HTML des Info-Panels aus den erweiterten EXIF-Daten sowie
 * ergänzenden, bereits im Programm bekannten Werten (Aufnahmedatum, Dateigröße).
 * Gemeinsam für Leuchtkasten- und Grid-Overlay verwendet.
 */
function renderExifPanelContent(entry, exifData) {
  const rows = [];

  const addRow = (label, value) => {
    if (value == null || value === "") return;
    rows.push(`<div class="exifRow"><span class="exifLabel">${escapeHtml(label)}</span><span class="exifValue">${escapeHtml(String(value))}</span></div>`);
  };

  if (exifData && (exifData.make || exifData.model)) {
    const cameraStr = [exifData.make, exifData.model].filter(Boolean).join(" ");
    addRow("Kamera", cameraStr);
  }
  if (exifData && exifData.lensModel) addRow("Objektiv", exifData.lensModel);

  const hasExposureInfo = exifData && (exifData.exposureTime != null || exifData.fNumber != null || exifData.iso != null || exifData.focalLength != null);
  if (hasExposureInfo) {
    if (rows.length > 0) rows.push('<div class="exifGroupGap"></div>');
    addRow("Belichtungszeit", formatExposureTime(exifData.exposureTime));
    addRow("Blende", formatFNumber(exifData.fNumber));
    addRow("ISO", exifData ? exifData.iso : null);
    addRow("Brennweite", formatFocalLength(exifData.focalLength, exifData.focalLength35mm));
    addRow("Blitz", formatFlash(exifData.flash));
    addRow("Weißabgleich", formatWhiteBalance(exifData.whiteBalance));
  }

  const gpsStr = exifData ? formatGpsCoordinate(exifData.gpsLatitude, exifData.gpsLongitude) : null;
  if (gpsStr || entry.captureDate) {
    if (rows.length > 0) rows.push('<div class="exifGroupGap"></div>');
    addRow("Aufnahmedatum", entry.captureDate ? formatDateTimeForDisplay(entry.captureDate) : null);
    addRow("Standort", gpsStr);
  }

  const dimStr = exifData ? formatDimensions(exifData.pixelWidth, exifData.pixelHeight) : null;
  if (dimStr || entry.fileSize != null) {
    if (rows.length > 0) rows.push('<div class="exifGroupGap"></div>');
    addRow("Abmessungen", dimStr);
    addRow("Dateigröße", entry.fileSize != null ? formatFileSizeForDisplay(entry.fileSize) : null);
  }

  const bodyHtml = rows.length > 0 ? rows.join("") : '<div class="exifEmpty">Keine EXIF-Daten verfügbar</div>';
  return `<div class="exifTitle">Bildinformationen</div>${bodyHtml}`;
}

function formatDateTimeForDisplay(date) {
  return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatFileSizeForDisplay(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ---- Leuchtkasten-Overlay ---- */

function toggleLightboxExifOverlay() {
  lightboxExifVisible = !lightboxExifVisible;
  applyLightboxExifVisibility();
  if (lightboxExifVisible) renderLightboxExifOverlay();
}

function applyLightboxExifVisibility() {
  document.getElementById("lightboxExifOverlay").classList.toggle("hidden", !lightboxExifVisible);
  document.getElementById("btnToggleExifOverlay").classList.toggle("active", lightboxExifVisible);
}

async function renderLightboxExifOverlay() {
  if (!lightboxExifVisible || lightboxIndex === -1) return;
  const entry = state.photos[lightboxIndex];
  const overlayEl = document.getElementById("lightboxExifOverlay");
  overlayEl.innerHTML = `<div class="exifOverlayPanel"><div class="exifTitle">Bildinformationen</div><div class="exifEmpty">Lädt…</div></div>`;

  const exifData = await getExtendedExifForEntry(entry);
  if (!lightboxExifVisible || lightboxIndex === -1 || state.photos[lightboxIndex] !== entry) return; // währenddessen weitergeblättert oder geschlossen
  overlayEl.innerHTML = `<div class="exifOverlayPanel">${renderExifPanelContent(entry, exifData)}</div>`;
}

document.getElementById("btnToggleExifOverlay").addEventListener("click", toggleLightboxExifOverlay);

/* ---- Grid-Overlay (nur bei genau einem ausgewählten Foto per Shortcut) ---- */

/**
 * Wird bei jeder Cursor-/Auswahländerung im Grid aufgerufen: hält das
 * EXIF-Overlay (falls offen) auf dem aktuell einzeln ausgewählten Foto
 * aktuell, oder schließt es, sobald keine eindeutige Einzelauswahl mehr
 * besteht (mehrere Fotos ausgewählt, oder kein Foto mehr angesteuert).
 */
function refreshGridExifOverlayIfVisible() {
  if (!gridExifVisible) return;
  const targets = getEffectiveTargetIndices();
  if (targets.length === 1) {
    renderGridExifOverlay(targets[0]);
  } else {
    closeGridExifOverlay();
  }
}

function toggleGridExifOverlay() {
  const targets = getEffectiveTargetIndices();
  if (targets.length !== 1) {
    showToast("Bildinformationen sind nur bei genau einem ausgewählten Foto verfügbar.", "info", 2500);
    return;
  }
  gridExifVisible = !gridExifVisible;
  if (gridExifVisible) renderGridExifOverlay(targets[0]);
  else closeGridExifOverlay();
}

function closeGridExifOverlay() {
  gridExifVisible = false;
  document.getElementById("gridExifOverlay").classList.add("hidden");
}

async function renderGridExifOverlay(index) {
  const entry = state.photos[index];
  if (!entry) return;
  const overlayEl = document.getElementById("gridExifOverlay");
  overlayEl.innerHTML = `<div class="exifOverlayPanel"><div class="exifTitle">Bildinformationen</div><div class="exifEmpty">Lädt…</div></div>`;
  overlayEl.classList.remove("hidden");
  positionGridExifOverlay(index);

  const exifData = await getExtendedExifForEntry(entry);
  if (!gridExifVisible || state.cursorIndex !== index) return; // währenddessen Auswahl geändert oder geschlossen
  overlayEl.innerHTML = `<div class="exifOverlayPanel">${renderExifPanelContent(entry, exifData)}</div>`;
  positionGridExifOverlay(index); // Größe kann sich durch den Inhalt geändert haben
}

/** Positioniert das Grid-Overlay neben der Zelle des übergebenen Foto-Index, mit Bildschirmrand-Kollisionsvermeidung. */
function positionGridExifOverlay(index) {
  const refs = cellElements[index];
  const overlayEl = document.getElementById("gridExifOverlay");
  if (!refs || !overlayEl) return;
  const cellRect = refs.root.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();

  let left = cellRect.right + 12;
  if (left + overlayRect.width > window.innerWidth - 8) {
    left = cellRect.left - overlayRect.width - 12; // rechts kein Platz -> links der Zelle anzeigen
  }
  if (left < 8) left = 8;

  let top = cellRect.top;
  if (top + overlayRect.height > window.innerHeight - 8) {
    top = window.innerHeight - overlayRect.height - 8;
  }
  if (top < 8) top = 8;

  overlayEl.style.left = `${left}px`;
  overlayEl.style.top = `${top}px`;
}

/**
 * Zeigt das Thumbnail des übergebenen Eintrags im Leuchtkasten an. Falls es noch
 * nicht geladen wurde (z. B. weil die Zelle im Grid nie sichtbar war), wird es
 * jetzt gezielt nachgeladen, statt dass der Leuchtkasten dauerhaft "Lädt…" zeigt.
 * Danach wird zusätzlich eine größere, schärfere Vorschau im Hintergrund geladen
 * (das kleine Grid-Thumbnail reicht für die Großansicht optisch nicht ganz aus).
 */
async function showLightboxImage(entry) {
  if (!entry.thumbUrl && !entry.thumbFailed) {
    const myLightboxIndex = lightboxIndex;
    await loadOneThumbnail(state.photos.indexOf(entry), thumbnailLoadGeneration);
    if (lightboxIndex !== myLightboxIndex) return; // währenddessen weitergeblättert
    updateCellThumb(state.photos.indexOf(entry)); // Grid-Zelle im Hintergrund gleich mitaktualisieren
  }

  renderLightboxImageElement(entry);

  // Größere Vorschau nachladen (blockiert die Anzeige des kleinen Thumbnails nicht)
  if (THUMBNAILABLE_EXTENSIONS.has(entry.ext) && !entry.largePreviewUrl) {
    const myLightboxIndex = lightboxIndex;
    loadLargePreview(entry).then(() => {
      if (lightboxIndex === myLightboxIndex && lightboxIndex !== -1) {
        renderLightboxImageElement(state.photos[lightboxIndex]);
      }
    });
  } else if (entry.largePreviewUrl) {
    touchLargePreview(entry); // bereits geladen: als zuletzt benutzt markieren, nicht verdrängen
  }
}

function renderLightboxImageElement(entry) {
  const showUrl = entry.largePreviewUrl || entry.thumbUrl;
  if (showUrl) {
    lightboxImgEl.src = showUrl;
    lightboxImgEl.alt = entry.name;
    lightboxImgEl.style.display = "";
    lightboxPlaceholderEl.style.display = "none";
  } else {
    lightboxImgEl.style.display = "none";
    lightboxPlaceholderEl.style.display = "";
    lightboxPlaceholderEl.textContent = entry.thumbFailed
      ? `Keine Vorschau verfügbar (${entry.ext.toUpperCase()})`
      : "Lädt…";
  }
}

async function loadLargePreview(entry) {
  try {
    const file = await entry.handle.getFile();
    // Bei RAW ist die Bildquelle das eingebettete Vorschau-JPEG. Dessen Auflösung
    // reicht bei den meisten Kameras an die volle heran - für Sichten und
    // Beurteilen genügt sie allemal.
    const source = RAW_EXTENSIONS.has(entry.ext) ? await extractRawPreviewBlob(file) : file;
    if (!source) return;
    entry.largePreviewUrl = await downscaleImageToObjectUrl(source, 1600);
    touchLargePreview(entry);
  } catch (e) {
    // Kein Fehler-Toast nötig: das kleine Thumbnail bleibt als Fallback sichtbar.
  }
}

/* ============================================================
   LUPE (Leuchtkasten, Taste M)
   ============================================================
   Klassische Bildschirmlupe: folgt dem Mauszeiger über dem Foto, zeigt einen
   vergrößerten Bildausschnitt in einem runden Element. Nutzt für die
   Vergrößerung eine EIGENE, möglichst hochauflösende Bildversion (nicht die
   1600px-Vorschau des Leuchtkastens) - sonst würde die Lupe nur ein bereits
   herunterskaliertes, unscharfes Bild vergrößern. Diese Version wird erst bei
   Bedarf (Lupe aktiviert) geladen und am PhotoEntry gecacht, um die normale
   Leuchtkasten-Performance nicht zu belasten.
   ============================================================ */

const LOUPE_ZOOM_FACTOR = 2.5;
const LOUPE_MAX_EDGE = 6000; // praktisch "keine Verkleinerung" für alle realistischen Fotogrößen

/** Lädt (mit Cache am PhotoEntry) eine möglichst hochauflösende Bildversion speziell für die Lupe. */
async function getFullResUrlForLoupe(entry) {
  if (entry.fullResUrl) {
    touchLargePreview(entry);
    return entry.fullResUrl;
  }
  const istRaw = RAW_EXTENSIONS.has(entry.ext);
  if (!istRaw && entry.ext !== "jpg" && entry.ext !== "jpeg") return entry.largePreviewUrl || entry.thumbUrl;
  try {
    const file = await entry.handle.getFile();
    // Bei RAW ist das eingebettete JPEG die höchste verfügbare Auflösung.
    const source = istRaw ? await extractRawPreviewBlob(file) : file;
    if (!source) return entry.largePreviewUrl || entry.thumbUrl;
    entry.fullResUrl = await downscaleImageToObjectUrl(source, LOUPE_MAX_EDGE);
    touchLargePreview(entry);
    return entry.fullResUrl;
  } catch (e) {
    return entry.largePreviewUrl || entry.thumbUrl; // Fallback auf die bereits vorhandene, kleinere Version
  }
}

async function toggleLoupe() {
  loupeActive = !loupeActive;
  applyLoupeVisibility();
  if (loupeActive) await refreshLoupeForCurrentPhoto();
}

/** Lädt (falls die Lupe aktiv ist) die Volltauflösungs-Version des aktuell angezeigten Fotos nach. */
async function refreshLoupeForCurrentPhoto() {
  if (!loupeActive || lightboxIndex === -1) return;
  const entry = state.photos[lightboxIndex];
  const myIndex = lightboxIndex;
  const url = await getFullResUrlForLoupe(entry);
  if (!loupeActive || lightboxIndex !== myIndex) return; // währenddessen weitergeblättert oder Lupe geschlossen
  document.getElementById("loupeLens").style.backgroundImage = url ? `url(${url})` : "none";
}

function applyLoupeVisibility() {
  document.getElementById("loupeLens").classList.toggle("hidden", !loupeActive);
  document.getElementById("btnToggleLoupe").classList.toggle("active", loupeActive);
  document.getElementById("lightboxBody").classList.toggle("loupeActive", loupeActive);
}

function closeLoupe() {
  if (!loupeActive) return;
  loupeActive = false;
  applyLoupeVisibility();
}

/**
 * Positioniert die Lupe am Mauszeiger und berechnet den vergrößerten
 * Bildausschnitt. Berücksichtigt, dass das <img>-Element durch object-fit:contain
 * meist NICHT die volle Breite/Höhe seines Containers einnimmt (Letterboxing) -
 * die Lupe darf nur reagieren, während der Zeiger tatsächlich über dem
 * sichtbaren Bildbereich steht, und muss die Vergrößerung relativ zur
 * tatsächlichen (nicht der Container-) Bildgröße berechnen.
 */
function updateLoupePosition(clientX, clientY) {
  if (!loupeActive) return;
  const img = document.querySelector("#lightboxImgWrap img");
  const lens = document.getElementById("loupeLens");
  if (!img) { lens.classList.add("hidden"); return; }

  const imgRect = img.getBoundingClientRect();
  const withinImage =
    clientX >= imgRect.left && clientX <= imgRect.right &&
    clientY >= imgRect.top && clientY <= imgRect.bottom;

  if (!withinImage) {
    lens.classList.add("hidden");
    return;
  }
  lens.classList.remove("hidden");

  const relX = (clientX - imgRect.left) / imgRect.width; // 0..1 relativ zum sichtbaren Bild
  const relY = (clientY - imgRect.top) / imgRect.height;

  const lensSize = lens.offsetWidth;
  const bgWidth = imgRect.width * LOUPE_ZOOM_FACTOR;
  const bgHeight = imgRect.height * LOUPE_ZOOM_FACTOR;
  const bgPosX = -(relX * bgWidth - lensSize / 2);
  const bgPosY = -(relY * bgHeight - lensSize / 2);

  lens.style.left = `${clientX}px`;
  lens.style.top = `${clientY}px`;
  lens.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
  lens.style.backgroundPosition = `${bgPosX}px ${bgPosY}px`;
}

document.getElementById("btnToggleLoupe").addEventListener("click", toggleLoupe);
document.getElementById("lightboxBody").addEventListener("mousemove", (ev) => {
  updateLoupePosition(ev.clientX, ev.clientY);
});
document.getElementById("lightboxBody").addEventListener("mouseleave", () => {
  if (loupeActive) document.getElementById("loupeLens").classList.add("hidden");
});

/** Lädt die Thumbnails der direkt benachbarten Fotos vor, damit Weiterblättern sofort reagiert. */
function preloadNeighborThumbnails(index) {
  [index - 1, index + 1].forEach((i) => {
    if (i < 0 || i >= state.photos.length) return;
    const entry = state.photos[i];
    if (!entry.thumbUrl && !entry.thumbFailed) {
      loadOneThumbnail(i, thumbnailLoadGeneration).then(() => updateCellThumb(i));
    }
  });
}

function lightboxSetAction(action) {
  if (lightboxIndex === -1) return;
  scheduleSessionSave();
  const entry = state.photos[lightboxIndex];
  if (entry.action === "move") actionCounts.move--;
  else if (entry.action === "delete") actionCounts.delete--;
  entry.action = action;
  if (action === "move") actionCounts.move++;
  else if (action === "delete") actionCounts.delete++;

  if (state.activeFilter !== "all") {
    const posBefore = positionInVisible(lightboxIndex);
    rebuildVisibleIndices();
    updateAllCellStates();
    updateFilterEmptyState();
    if (posBefore !== -1 && !matchesActiveFilter(lightboxIndex)) {
      // Foto ist durch die Aktion aus dem aktiven Filter herausgefallen ->
      // Leuchtkasten zeigt stattdessen das nächste weiterhin sichtbare Foto
      if (visibleIndices.length === 0) {
        closeLightbox();
        return;
      }
      const clampedPos = Math.min(posBefore, visibleIndices.length - 1);
      lightboxIndex = visibleIndices[clampedPos];
    }
  } else {
    updateCellVisualState(lightboxIndex);
  }

  renderLightbox();
  updateBottomBar();
}

/**
 * Blättert im Leuchtkasten um `delta` Positionen innerhalb der aktuell sichtbaren
 * (nicht gefilterten) Fotos, konsistent mit der Grid-Navigation.
 */
function lightboxNav(delta) {
  const currentPos = positionInVisible(lightboxIndex);
  if (currentPos === -1) return;
  const newPos = currentPos + delta;
  if (newPos < 0 || newPos >= visibleIndices.length) return;
  lightboxIndex = visibleIndices[newPos];
  renderLightbox();
}

function onLightboxKeydown(ev) {
  // Wenn der Fokus in einem Texteingabefeld des Panels liegt (z.B. Stichwort-Suche),
  // sollen normale Zeichen dort ganz normal getippt werden können - keine der
  // Leuchttisch-Kürzel darf das überschreiben.
  const isTypingInInput = ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA";

  if (ev.key === "Escape") {
    ev.preventDefault();
    if (isTypingInInput) { ev.target.blur(); return; }
    if (loupeActive) { closeLoupe(); return; } // Lupe zuerst schließen
    if (lightboxExifVisible) { toggleLightboxExifOverlay(); return; } // dann Info-Overlay
    closeLightbox();
    return;
  }
  if (isTypingInInput) return; // andere Kürzel nicht abfangen, während getippt wird
  // Kürzel mit Modifikator gehören dem Browser (Strg+V, Strg+L, Strg+1..9, ...) -
  // sie dürfen hier nicht als Aktions-Kürzel umgedeutet werden.
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

  switch (ev.key) {
    case "ArrowRight":
      ev.preventDefault();
      lightboxNav(1);
      break;
    case "ArrowLeft":
      ev.preventDefault();
      lightboxNav(-1);
      break;
    case "v":
    case "V":
      ev.preventDefault();
      lightboxSetAction("move");
      break;
    case "l":
    case "L":
      ev.preventDefault();
      lightboxSetAction("delete");
      break;
    case "x":
    case "X":
      ev.preventDefault();
      lightboxSetAction("none");
      break;
    case "t":
    case "T":
      ev.preventDefault();
      toggleLightboxPanel();
      break;
    case "i":
    case "I":
      ev.preventDefault();
      toggleLightboxExifOverlay();
      break;
    case "m":
    case "M":
      ev.preventDefault();
      toggleLoupe();
      break;
    case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9":
      ev.preventDefault();
      applyFavoriteToLightbox(Number(ev.key) - 1);
      break;
  }
}

document.getElementById("btnCloseLightbox").addEventListener("click", closeLightbox);
document.getElementById("lbPrev").addEventListener("click", () => lightboxNav(-1));
document.getElementById("lbNext").addEventListener("click", () => lightboxNav(1));
document.getElementById("lbMoveBtn").addEventListener("click", () => lightboxSetAction("move"));
document.getElementById("lbDeleteBtn").addEventListener("click", () => lightboxSetAction("delete"));
document.getElementById("lbClearBtn").addEventListener("click", () => lightboxSetAction("none"));

/* ============================================================
   LEUCHTTISCH: SEITENPANEL FÜR STICHWORT-ZUWEISUNG
   (bewusst dieselben Kernfunktionen wie im Grid-Panel - nur mit [lightboxIndex]
   als Ziel statt getEffectiveTargetIndices(), damit sich die Bedienung nicht
   unterscheidet und man nicht umlernen muss)
   ============================================================ */

let lightboxPanelVisible = true; // Panel startet standardmäßig sichtbar

function toggleLightboxPanel() {
  lightboxPanelVisible = !lightboxPanelVisible;
  applyLightboxPanelVisibility();
}

function applyLightboxPanelVisibility() {
  document.getElementById("lightboxPanel").classList.toggle("hidden", !lightboxPanelVisible);
  document.getElementById("btnToggleLbPanel").classList.toggle("active", lightboxPanelVisible);
}

document.getElementById("btnToggleLbPanel").addEventListener("click", toggleLightboxPanel);

/** Favoriten-Taste 1-9 im Leuchttisch: identisches Toggle-Verhalten wie im Grid, aber nur für das aktuell angezeigte Foto. */
function applyFavoriteToLightbox(slotIndex) {
  if (lightboxIndex === -1) return;
  const fav = getCatalog().favorites[slotIndex];
  if (!fav) {
    showToast(`Favorit ${slotIndex + 1} ist nicht belegt. Im Stichwortkatalog einrichten.`, "info", 3000);
    return;
  }
  const label = favoriteLabel(fav);
  toggleKeywordOnTargets([lightboxIndex], label);
  refreshAfterLightboxKeywordChange();
}

/** Einzelnes Stichwort (Panel-Suche) im Leuchttisch zuweisen/entfernen - Toggle wie im Grid-Panel. */
function applyKeywordLabelToLightbox(label) {
  if (lightboxIndex === -1) return;
  toggleKeywordOnTargets([lightboxIndex], label);
  refreshAfterLightboxKeywordChange();
}

/** Ganze Gruppe/Set im Leuchttisch zuweisen (immer hinzufügen, kein Toggle - wie im Grid-Panel). */
function applyContainerToLightbox(container) {
  if (lightboxIndex === -1) return;
  const labels = container.keywordIds.map((kid) => findKeyword(kid)?.label).filter(Boolean);
  if (labels.length === 0) return;
  addKeywordsToTargets([lightboxIndex], labels);
  refreshAfterLightboxKeywordChange();
  showToast(`${labels.length} Stichwort(e) aus „${container.name}“ zugewiesen.`, "success", 2000);
}

/** Ganze Gruppe/Set im Leuchttisch wieder entfernen. */
function removeContainerFromLightbox(container) {
  if (lightboxIndex === -1) return;
  const labels = container.keywordIds.map((kid) => findKeyword(kid)?.label).filter(Boolean);
  if (labels.length === 0) return;
  removeKeywordsFromTargets([lightboxIndex], labels);
  refreshAfterLightboxKeywordChange();
}

/**
 * Nach einer Stichwort-Änderung im Leuchttisch: Grid-Zelle im Hintergrund
 * synchron halten (bidirektionale Konsistenz - im Leuchttisch zugewiesene
 * Stichworte erscheinen sofort auch im Grid), Panel/Overlay/Filmstreifen
 * neu zeichnen, und - falls ein Stichwort-Filter aktiv ist - die sichtbare
 * Menge ggf. neu aufbauen, analog zum Grid-Verhalten.
 */
function refreshAfterLightboxKeywordChange() {
  scheduleSessionSave();
  if (state.activeFilter === "hasKeywords" || state.activeFilter === "noKeywords") {
    const posBefore = positionInVisible(lightboxIndex);
    rebuildVisibleIndices();
    updateAllCellStates();
    updateFilterEmptyState();
    if (posBefore !== -1 && !matchesActiveFilter(lightboxIndex)) {
      if (visibleIndices.length === 0) {
        closeLightbox();
        return;
      }
      const clampedPos = Math.min(posBefore, visibleIndices.length - 1);
      lightboxIndex = visibleIndices[clampedPos];
    }
  } else {
    updateCellVisualState(lightboxIndex); // Grid-Kachel synchron halten
  }
  const entry = state.photos[lightboxIndex];
  renderLightboxKeywordOverlay(entry);
  renderLightboxPanel();
  renderFilmstrip();
  updateBottomBar();
}

/** Zeichnet den kompletten Panel-Inhalt für das aktuell angezeigte Foto neu. */
function renderLightboxPanel() {
  if (lightboxIndex === -1) return;
  const entry = state.photos[lightboxIndex];
  renderLbAssignedChips(entry);
  renderExistingKeywordRow("lbExistingSection", "lbExistingRow", [lightboxIndex], () => {
    refreshAfterLightboxKeywordChange();
  });
  renderLbFavoritesRow(entry);
  renderLbContainerRow("lbGroupsRow", getCatalog().groups, entry, applyContainerToLightbox, removeContainerFromLightbox);
  renderLbContainerRow("lbSetsRow", getCatalog().sets, entry, applyContainerToLightbox, removeContainerFromLightbox);
  renderLbKeywordResults(document.getElementById("lbKeywordSearch").value, entry);
}

/** Ausgeschriebene Chip-Liste mit einzeln klickbarem "✕" - der im Mockup gezeigte direkte Entfernungsweg. */
function renderLbAssignedChips(entry) {
  const el = document.getElementById("lbAssignedChips");
  if (entry.assignedKeywords.length === 0) {
    el.innerHTML = `<div class="lbAssignedEmpty">Noch keine Stichworte zugewiesen.</div>`;
    return;
  }
  el.innerHTML = "";
  entry.assignedKeywords.forEach((label) => {
    const chip = document.createElement("div");
    chip.className = "lbAssignedChip";
    chip.innerHTML = `<span>${escapeHtml(label)}</span><button title="Entfernen">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      removeKeywordFromPhoto(lightboxIndex, label);
      refreshAfterLightboxKeywordChange();
    });
    el.appendChild(chip);
  });
}

function renderLbFavoritesRow(entry) {
  const row = document.getElementById("lbFavoritesRow");
  row.innerHTML = "";
  getCatalog().favorites.forEach((fav, index) => {
    const btn = document.createElement("button");
    btn.className = "assignFavBtn";
    if (!fav) {
      btn.disabled = true;
      btn.innerHTML = `<span class="favNum">${index + 1}</span><span class="favLabel">–</span>`;
    } else {
      const label = favoriteLabel(fav);
      btn.classList.toggle("assigned", entry.assignedKeywords.includes(label));
      btn.innerHTML = `<span class="favNum">${index + 1}</span><span class="favLabel">${escapeHtml(label)}</span>`;
      btn.addEventListener("click", () => applyFavoriteToLightbox(index));
    }
    row.appendChild(btn);
  });
}

/** Gemeinsames Rendering für Gruppen/Sets-Chips im Leuchttisch-Panel, analog zum Grid-Panel. */
function renderLbContainerRow(rowId, containers, entry, applyFn, removeFn) {
  const row = document.getElementById(rowId);
  row.innerHTML = "";
  if (containers.length === 0) {
    row.innerHTML = `<div class="assignKeywordEmpty">Noch keine angelegt.</div>`;
    return;
  }
  containers.forEach((container) => {
    const labels = container.keywordIds.map((kid) => findKeyword(kid)?.label).filter(Boolean);
    const chip = document.createElement("button");
    chip.className = "assignContainerChip";
    const fullyAssigned = labels.length > 0 && labels.every((label) => entry.assignedKeywords.includes(label));
    chip.classList.toggle("assigned", fullyAssigned);
    chip.innerHTML = `<span>${escapeHtml(container.name)}</span><span class="chipCount">${labels.length}</span>`;
    chip.addEventListener("click", () => {
      if (fullyAssigned) removeFn(container);
      else applyFn(container);
    });
    row.appendChild(chip);
  });
}

document.getElementById("lbKeywordSearch").addEventListener("input", (ev) => {
  if (lightboxIndex === -1) return;
  renderLbKeywordResults(ev.target.value, state.photos[lightboxIndex]);
});
document.getElementById("lbKeywordSearch").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    const text = ev.target.value.trim();
    if (!text) return;
    const existing = getCatalog().keywords.find((k) => k.label.toLowerCase() === text.toLowerCase());
    applyKeywordLabelToLightbox(existing ? existing.label : text);
    ev.target.value = "";
  }
});

function renderLbKeywordResults(filterText, entry) {
  const resultsEl = document.getElementById("lbKeywordResults");
  resultsEl.innerHTML = "";
  const needle = filterText.trim().toLowerCase();
  const catalog = getCatalog();

  const matching = catalog.keywords
    .filter((k) => !needle || k.label.toLowerCase().includes(needle))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));

  matching.forEach((kw) => {
    const isAssigned = entry.assignedKeywords.includes(kw.label);
    const item = document.createElement("div");
    item.className = "assignKeywordItem" + (isAssigned ? " assigned" : "");
    item.innerHTML = `<span>${escapeHtml(kw.label)}</span>${isAssigned ? '<span class="assignedMark">✓</span>' : ""}`;
    item.addEventListener("click", () => applyKeywordLabelToLightbox(kw.label));
    resultsEl.appendChild(item);
  });

  const hasExactMatch = catalog.keywords.some((k) => k.label.toLowerCase() === needle);
  if (needle && !hasExactMatch) {
    const freeItem = document.createElement("div");
    freeItem.className = "assignKeywordItem";
    freeItem.innerHTML = `<span>„${escapeHtml(filterText.trim())}“ als freies Stichwort verwenden</span>`;
    freeItem.addEventListener("click", () => {
      applyKeywordLabelToLightbox(filterText.trim());
      document.getElementById("lbKeywordSearch").value = "";
    });
    resultsEl.appendChild(freeItem);
  }
}

/* ============================================================
   LEUCHTTISCH: FILMSTREIFEN
   ============================================================ */

/**
 * Zeigt eine horizontal scrollbare Reihe kleiner Vorschaubilder der sichtbaren
 * (nicht gefilterten) Fotos rund um das aktuelle. Klick springt direkt zu dem
 * Foto, ohne den Leuchttisch verlassen zu müssen. Aktions- und Stichwort-Status
 * werden als Mini-Indikatoren gespiegelt, analog zum Grid.
 */
const FILMSTRIP_RADIUS = 25; // Anzahl Zellen links/rechts der aktuellen Position

function renderFilmstrip() {
  const strip = document.getElementById("lightboxFilmstrip");
  strip.innerHTML = "";
  const currentPos = positionInVisible(lightboxIndex);
  const myGeneration = thumbnailLoadGeneration;

  // Nur einen Ausschnitt um die aktuelle Position rendern, nicht die komplette
  // sichtbare Liste - bei tausenden Fotos wäre das bei jedem Blättern zu teuer.
  const startPos = Math.max(0, currentPos - FILMSTRIP_RADIUS);
  const endPos = Math.min(visibleIndices.length - 1, currentPos + FILMSTRIP_RADIUS);

  for (let pos = startPos; pos <= endPos; pos++) {
    const photoIndex = visibleIndices[pos];
    const entry = state.photos[photoIndex];
    const cell = document.createElement("div");
    cell.className = "filmCell" + (pos === currentPos ? " current" : "");
    if (entry.action === "move") cell.classList.add("action-move");
    else if (entry.action === "delete") cell.classList.add("action-delete");

    const badgeText = entry.action === "move" ? "V" : entry.action === "delete" ? "L" : "";
    cell.innerHTML = `
      ${entry.thumbUrl ? `<img src="${entry.thumbUrl}" alt="">` : ""}
      ${badgeText ? `<span class="filmBadge">${badgeText}</span>` : ""}
      ${entry.assignedKeywords.length > 0 ? `<span class="filmKwDot">🏷</span>` : ""}
    `;
    cell.addEventListener("click", () => {
      lightboxIndex = photoIndex;
      renderLightbox();
    });
    strip.appendChild(cell);

    // Fehlt das Thumbnail noch (Foto war im Grid nie sichtbar, IntersectionObserver
    // hat es nie angefragt), jetzt gezielt nachladen, statt eine leere Zelle zu zeigen.
    if (!entry.thumbUrl && !entry.thumbFailed) {
      loadOneThumbnail(photoIndex, myGeneration).then(() => {
        if (myGeneration !== thumbnailLoadGeneration) return;
        updateCellThumb(photoIndex); // Grid im Hintergrund mitaktualisieren
        if (entry.thumbUrl) {
          const img = document.createElement("img");
          img.src = entry.thumbUrl;
          img.alt = "";
          cell.prepend(img);
        }
      });
    }

    if (pos === currentPos) {
      // Direkt nach dem Einfügen zentrieren, damit das aktuelle Foto im Filmstreifen sichtbar bleibt
      requestAnimationFrame(() => cell.scrollIntoView({ block: "nearest", inline: "center" }));
    }
  }
}
