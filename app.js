"use strict";

/* ============================================================
   KONSTANTEN & STATE
   ============================================================ */

const PHOTO_EXTENSIONS = new Set([
  "jpg","jpeg","png","heic","heif","gif","bmp","webp",
  "cr2","nef","arw","dng","raf","orf","rw2","srw" // RAW-Formate
]);
const THUMBNAILABLE_EXTENSIONS = new Set(["jpg","jpeg","png","gif","bmp","webp","heic","heif"]);

const STORAGE_KEY_SETTINGS = "fotoImporter.settings.v1";

/** @type {{
 *   sourceDirHandle: FileSystemDirectoryHandle|null,
 *   targetDirHandle: FileSystemDirectoryHandle|null,
 *   photos: Array<PhotoEntry>,
 *   cursorIndex: number,
 *   selectedIndices: Set<number>,
 *   activeFilter: 'all'|'move'|'delete'|'none'|'hasKeywords'|'noKeywords',
 *   sortKey: 'name'|'fileDate'|'captureDate'|'fileSize',
 *   sortDirection: 'asc'|'desc',
 *   includeSubfolders: boolean,
 *   lastRunLog: Object|null,
 * }} */
const state = {
  sourceDirHandle: null,
  targetDirHandle: null,
  photos: [],
  cursorIndex: -1,
  selectedIndices: new Set(),
  activeFilter: "all",
  sortKey: "captureDate", // bisheriges Standardverhalten beibehalten
  sortDirection: "asc",
  includeSubfolders: false,
  // Protokoll des zuletzt ausgeführten Durchgangs (siehe PROTOKOLL & RÜCKGÄNGIG).
  // Nur für die aktuelle Sitzung; die Protokolldatei im Ziel überlebt den Reload.
  lastRunLog: null,
};

/**
 * @typedef {Object} PhotoEntry
 * @property {string} name
 * @property {FileSystemFileHandle} handle
 * @property {FileSystemDirectoryHandle} dirHandle - Ordner, in dem die Datei LIEGT.
 *   Nicht zwingend das Quellverzeichnis: beim Einlesen mit Unterordnern muss zum
 *   Löschen der Handle des tatsächlich enthaltenden Ordners verwendet werden.
 * @property {string} relPath - Pfad des enthaltenden Ordners relativ zur Quelle
 *   ("" für Dateien direkt im Quellverzeichnis), mit "/" als Trenner
 * @property {string} ext
 * @property {string|null} thumbUrl - kleines Grid-Thumbnail (schnell, downscaled)
 * @property {string|null} largePreviewUrl - größere Vorschau für den Leuchtkasten (bei Bedarf nachgeladen)
 * @property {string|null} fullResUrl - möglichst hochauflösende Version für die Lupe (bei Bedarf nachgeladen)
 * @property {boolean} thumbFailed
 * @property {Date|null} captureDate - Aufnahmedatum (EXIF, Fallback Dateidatum)
 * @property {Date|null} fileDate - Datei-Änderungsdatum (lastModified), unabhängig vom Aufnahmedatum
 * @property {number|null} fileSize - Dateigröße in Bytes
 * @property {'none'|'move'|'delete'} action
 * @property {string[]|null} existingKeywords - im Foto bereits vorhandene Stichworte
 *   (IPTC/XMP), rein informativ; null = noch nicht gelesen oder Format ohne Metadaten
 * @property {string|null} existingDescription - vorhandene Beschreibung, dito
 * @property {string[]} assignedKeywords - zugewiesene Stichwort-Labels (als Text, nicht als
 *   Katalog-ID gespeichert: ein einmal zugewiesenes Stichwort bleibt am Foto erhalten,
 *   auch wenn es später aus dem Katalog gelöscht oder umbenannt wird)
 */

/* ============================================================
   PERSISTENTE EINSTELLUNGEN (localStorage)
   ============================================================ */

/**
 * Datenmodell des Stichwortkatalogs:
 * - keywords: globaler Pool aller Stichworte { id, label } - Gruppen und Sets
 *   referenzieren Stichworte über ihre id, sodass ein Stichwort in mehreren
 *   Gruppen/Sets gleichzeitig vorkommen kann und beim Umbenennen überall
 *   automatisch aktuell bleibt.
 * - groups: thematische Bündel { id, name, keywordIds: [] }
 * - sets: ereignisbezogene Bündel { id, name, keywordIds: [] }
 * - favorites: genau 9 Slots (Array der Länge 9), jeder Slot ist entweder
 *   null, { type: 'keyword', keywordId } oder { type: 'free', label }
 */
function createEmptyKeywordCatalog() {
  return {
    keywords: [],
    groups: [],
    sets: [],
    favorites: new Array(9).fill(null),
  };
}

function createDefaultSettings() {
  return {
    presets: {},
    lastPreset: null,
    keywordCatalog: createEmptyKeywordCatalog(),
    includeSubfolders: false,
  };
}

/**
 * Bringt ein geladenes oder importiertes Einstellungsobjekt auf die erwartete
 * Form. Bewusst EINE Stelle für beide Wege: der Import liest eine beliebige
 * fremde JSON-Datei, und die Fassung im localStorage kann aus einer älteren
 * Programmversion stammen. Ein neues Einstellungsfeld gehört hierher - sonst
 * fehlt es genau auf dem Weg, den man beim Ergänzen nicht im Blick hatte.
 * @param {any} parsed
 * @returns {Object}
 */
function normalizeSettings(parsed) {
  if (!parsed || typeof parsed !== "object") return createDefaultSettings();
  parsed.presets = normalizePresets(parsed.presets);
  if (!parsed.keywordCatalog || typeof parsed.keywordCatalog !== "object") {
    parsed.keywordCatalog = createEmptyKeywordCatalog();
  }
  normalizeKeywordCatalog(parsed.keywordCatalog);
  if (typeof parsed.lastPreset !== "string" || !parsed.presets[parsed.lastPreset]) {
    parsed.lastPreset = null;
  }
  parsed.includeSubfolders = parsed.includeSubfolders === true;
  return parsed;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return createDefaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch (e) {
    console.warn("Einstellungen konnten nicht geladen werden, verwende Standard.", e);
    return createDefaultSettings();
  }
}

/**
 * Stellt sicher, dass ein geladener/importierter Katalog alle erwarteten Felder
 * hat UND dass jedes Feld den erwarteten Typ hat.
 *
 * Die Typprüfung ist nicht bloß Kosmetik: Einstellungen lassen sich als beliebige
 * JSON-Datei importieren, und Stichwort-Labels landen anschließend in der
 * Oberfläche. Was hier durchrutscht, wandert ungeprüft ins DOM. Einträge, die
 * nicht die erwartete Form haben, werden deshalb verworfen statt notdürftig
 * repariert - ein fehlendes Stichwort ist harmloser als ein unbekanntes Objekt
 * an einer Stelle, an der die Oberfläche eine Zeichenkette erwartet.
 */
function normalizeKeywordCatalog(catalog) {
  const asText = (value) => (typeof value === "string" ? value : "");

  const rawKeywords = Array.isArray(catalog.keywords) ? catalog.keywords : [];
  catalog.keywords = rawKeywords
    .filter((k) => k && typeof k === "object")
    .map((k) => ({ id: asText(k.id) || generateCatalogId(), label: asText(k.label) }))
    .filter((k) => k.label.length > 0);

  const knownIds = new Set(catalog.keywords.map((k) => k.id));
  const normalizeContainer = (c) => ({
    id: asText(c.id) || generateCatalogId(),
    name: asText(c.name),
    // Verweise auf nicht (mehr) vorhandene Stichworte fallen weg - sie würden im
    // Katalog sonst als stumme Lücken auftauchen.
    keywordIds: (Array.isArray(c.keywordIds) ? c.keywordIds : []).filter((id) => knownIds.has(id)),
  });
  const normalizeContainerList = (list) =>
    (Array.isArray(list) ? list : []).filter((c) => c && typeof c === "object").map(normalizeContainer);

  catalog.groups = normalizeContainerList(catalog.groups);
  catalog.sets = normalizeContainerList(catalog.sets);

  const rawFavorites = Array.isArray(catalog.favorites) ? catalog.favorites : [];
  catalog.favorites = new Array(9).fill(null).map((_, i) => {
    const fav = rawFavorites[i];
    if (!fav || typeof fav !== "object") return null;
    if (fav.type === "keyword" && knownIds.has(asText(fav.keywordId))) {
      return { type: "keyword", keywordId: asText(fav.keywordId) };
    }
    if (fav.type === "free" && asText(fav.label)) {
      return { type: "free", label: asText(fav.label) };
    }
    return null;
  });
}

/** Gültige Bausteintypen eines Namensschemas (siehe TOKEN_LABELS). */
const VALID_FORMAT_TOKEN_TYPES = new Set([
  "date", "event", "counter", "text", "sep_underscore", "sep_dash",
]);

/**
 * Bringt die Namensschema-Voreinstellungen auf die erwartete Form. Ein Baustein
 * mit unbekanntem Typ würde im Builder als "undefined" erscheinen und beim
 * Bauen des Dateinamens stillschweigend zu einem leeren Teil werden.
 */
function normalizePresets(presets) {
  if (!presets || typeof presets !== "object") return {};
  const result = {};
  for (const [name, preset] of Object.entries(presets)) {
    if (!preset || typeof preset !== "object") continue;
    const tokens = (Array.isArray(preset.tokens) ? preset.tokens : [])
      .filter((t) => t && typeof t === "object" && VALID_FORMAT_TOKEN_TYPES.has(t.type))
      .map((t) => ({ type: t.type }));
    result[String(name)] = {
      tokens,
      counterStart: Number.isFinite(preset.counterStart) ? preset.counterStart : 1,
      counterDigits: Number.isFinite(preset.counterDigits) ? preset.counterDigits : 3,
      freeText: typeof preset.freeText === "string" ? preset.freeText : "",
    };
  }
  return result;
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
}

let appSettings = loadSettings();

/* Aktuelles (nicht notwendigerweise gespeichertes) Namensschema */
let currentFormatTokens = []; // Array von { type: 'date'|'event'|'counter'|'text'|'sep_underscore'|'sep_dash' }
let currentCounterStart = 1;
let currentCounterDigits = 3;
let currentFreeText = "";

function applyDefaultFormatIfNone() {
  if (appSettings.lastPreset && appSettings.presets[appSettings.lastPreset]) {
    loadPresetIntoBuilder(appSettings.lastPreset);
  } else {
    currentFormatTokens = [
      { type: "date" },
      { type: "sep_underscore" },
      { type: "event" },
    ];
    currentCounterStart = 1;
    currentCounterDigits = 3;
    currentFreeText = "";
  }
}
applyDefaultFormatIfNone();

/* ============================================================
   TOAST-NACHRICHTEN
   ============================================================ */

function showToast(message, type = "info", duration = 4000) {
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : type === "success" ? " success" : "");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ============================================================
   FILE SYSTEM ACCESS API – VERFÜGBARKEITSPRÜFUNG
   ============================================================ */

function checkFileSystemAccessSupport() {
  if (!("showDirectoryPicker" in window)) {
    showToast(
      "Dieser Browser unterstützt die File System Access API nicht. Bitte Chrome oder Edge (Desktop) verwenden.",
      "error",
      10000
    );
    return false;
  }
  return true;
}

/* ============================================================
   QUELLVERZEICHNIS ÖFFNEN & FOTOS LADEN
   ============================================================ */

const includeSubfoldersCheckbox = document.getElementById("includeSubfolders");
state.includeSubfolders = appSettings.includeSubfolders === true;
includeSubfoldersCheckbox.checked = state.includeSubfolders;

includeSubfoldersCheckbox.addEventListener("change", async () => {
  state.includeSubfolders = includeSubfoldersCheckbox.checked;
  appSettings.includeSubfolders = state.includeSubfolders;
  saveSettings(appSettings);
  // Umschalten ändert die Menge der Fotos, also neu einlesen - aber nicht ungefragt
  // über bereits vergebene Markierungen und Stichworte hinweg, die dabei verloren gingen.
  if (!state.sourceDirHandle) return;
  const marked = state.photos.filter((p) => p.action !== "none" || p.assignedKeywords.length > 0).length;
  if (marked > 0 && !confirm(
    `Das Quellverzeichnis wird neu eingelesen. ${marked} bereits vorgenommene Markierung(en)/Zuweisung(en) gehen dabei verloren.\n\nFortfahren?`
  )) {
    state.includeSubfolders = !state.includeSubfolders;
    includeSubfoldersCheckbox.checked = state.includeSubfolders;
    appSettings.includeSubfolders = state.includeSubfolders;
    saveSettings(appSettings);
    return;
  }
  await loadPhotosFromSource();
});

document.getElementById("btnOpenSource").addEventListener("click", async () => {
  if (!checkFileSystemAccessSupport()) return;
  try {
    // "readwrite": aus dem Quellverzeichnis werden Dateien gelöscht (verschieben =
    // kopieren + löschen). Mit "read" würde removeEntry() erst beim Ausführen
    // scheitern - also lieber gleich beim Öffnen fragen, wenn der Zusammenhang
    // für den Nutzer noch erkennbar ist.
    const dirHandle = await window.showDirectoryPicker({ id: "photoSource", mode: "readwrite" });
    state.sourceDirHandle = dirHandle;
    document.getElementById("sourcePathLabel").textContent = dirHandle.name;
    await loadPhotosFromSource();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      showToast("Quellverzeichnis konnte nicht geöffnet werden: " + e.message, "error");
    }
  }
});

document.getElementById("btnOpenTarget").addEventListener("click", async () => {
  if (!checkFileSystemAccessSupport()) return;
  try {
    const dirHandle = await window.showDirectoryPicker({ id: "photoTarget", mode: "readwrite" });
    state.targetDirHandle = dirHandle;
    document.getElementById("targetPathLabel").textContent = dirHandle.name;
    updateRunButtonState();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      showToast("Zielverzeichnis konnte nicht gewählt werden: " + e.message, "error");
    }
  }
});

/**
 * Obergrenze für die Rekursionstiefe beim Einlesen mit Unterordnern. Die File
 * System Access API kennt keine Symlinks, eine Endlosschleife ist also nicht zu
 * befürchten - die Grenze schützt vor versehentlich gewählten Wurzelverzeichnissen
 * mit sehr tiefen Bäumen, bei denen das Einlesen sonst minutenlang liefe.
 */
const MAX_SUBFOLDER_DEPTH = 8;

/** Baut einen PhotoEntry aus einem gefundenen Datei-Handle. */
function createPhotoEntry(name, handle, dirHandle, relPath) {
  return {
    name,
    handle,
    dirHandle,
    relPath,
    ext: getExtension(name),
    thumbUrl: null,
    largePreviewUrl: null,
    fullResUrl: null,
    thumbFailed: false,
    captureDate: null,
    fileDate: null,
    fileSize: null,
    action: "none",
    existingKeywords: null,
    existingDescription: null,
    assignedKeywords: [],
  };
}

/**
 * Sammelt alle unterstützten Fotodateien eines Ordners ein, auf Wunsch auch aus
 * dessen Unterordnern. Versteckte Ordner (Name beginnt mit einem Punkt) werden
 * ausgelassen: dort liegen auf Speicherkarten und externen Platten typischerweise
 * Papierkorb- und Indexdaten des Betriebssystems, keine zu sichtenden Fotos.
 */
async function collectPhotoEntries(dirHandle, relPath, recurse, depth, sink) {
  const subDirs = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") {
      if (recurse && depth < MAX_SUBFOLDER_DEPTH && !name.startsWith(".")) {
        subDirs.push([name, handle]);
      }
      continue;
    }
    if (!PHOTO_EXTENSIONS.has(getExtension(name))) continue;
    sink.push(createPhotoEntry(name, handle, dirHandle, relPath));
  }
  // Unterordner erst nach den Dateien der aktuellen Ebene, und alphabetisch: die
  // Reihenfolge von entries() ist nicht garantiert, und ein reproduzierbarer
  // Einlesevorgang ist beim Vergleich zweier Durchläufe viel wert.
  subDirs.sort((a, b) => a[0].localeCompare(b[0], "de"));
  for (const [name, handle] of subDirs) {
    await collectPhotoEntries(handle, relPath ? `${relPath}/${name}` : name, recurse, depth + 1, sink);
  }
}

async function loadPhotosFromSource() {
  setStatus("Lade Verzeichnis…");
  const dirHandle = state.sourceDirHandle;
  const entries = [];

  await collectPhotoEntries(dirHandle, "", state.includeSubfolders, 0, entries);

  if (entries.length === 0) {
    showToast(
      state.includeSubfolders
        ? "Keine unterstützten Fotodateien im gewählten Ordner und seinen Unterordnern gefunden."
        : "Keine unterstützten Fotodateien im gewählten Ordner gefunden.",
      "info"
    );
  }

  setStatus(`Lese Aufnahmedaten (${entries.length} Dateien)…`);

  // Aufnahmedatum ermitteln (EXIF, Fallback: Datei-Erstellungsdatum via lastModified),
  // sowie Dateidatum und -größe als eigenständige Sortierkriterien erfassen.
  await Promise.all(entries.map(async (entry) => {
    try {
      const file = await entry.handle.getFile();
      entry.fileDate = new Date(file.lastModified);
      entry.fileSize = file.size;

      let date = null;
      if (DIRECT_WRITE_EXTENSIONS.has(entry.ext)) {
        // Eine Leseoperation für beides: Aufnahmedatum und die bereits im Foto
        // hinterlegten Stichworte. Die Datei ein zweites Mal zu lesen, nur um
        // die Metadaten zu holen, würde das Einlesen großer Ordner verdoppeln.
        const buf = await file.arrayBuffer();
        date = readExifDate(buf);
        const vorhanden = readExistingKeywords(new Uint8Array(buf));
        entry.existingKeywords = vorhanden.keywords;
        entry.existingDescription = vorhanden.description;
      }
      if (!date) {
        date = entry.fileDate;
      }
      entry.captureDate = date;
    } catch (e) {
      entry.captureDate = new Date(0);
      entry.fileDate = new Date(0);
      entry.fileSize = 0;
    }
  }));

  sortPhotoEntries(entries, state.sortKey, state.sortDirection);

  revokePhotoObjectUrls(state.photos); // alte Vorschauen freigeben, bevor die Liste ersetzt wird
  state.photos = entries;
  state.cursorIndex = entries.length > 0 ? 0 : -1;
  state.selectedIndices.clear();
  state.activeFilter = "all"; // neuer Ordner -> Filter vom vorherigen Ordner wäre verwirrend
  updateFilterButtonsUI();
  recomputeActionCounts(); // neu geladene Fotos haben durchgehend action:'none' -> Zähler auf 0

  renderGrid();
  setStatus(`${entries.length} Fotos geladen.`);
  updateBottomBar();
  updateRunButtonState();
  // Thumbnails werden lazy per IntersectionObserver geladen (ausgelöst in renderGrid()),
  // nicht mehr pauschal für alle Fotos auf einmal – das hält den Start bei großen
  // Ordnern (hunderte/tausende Fotos) schnell.
}

/**
 * Anzeigename eines Fotos: mit Unterordner-Pfad, sobald einer vorhanden ist.
 * Beim Einlesen mit Unterordnern können mehrere Dateien gleich heißen - ohne den
 * Pfad wäre in der Oberfläche nicht mehr erkennbar, welche gemeint ist.
 */
function photoDisplayName(entry) {
  return entry.relPath ? `${entry.relPath}/${entry.name}` : entry.name;
}

function getExtension(filename) {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

/* ============================================================
   SORTIERUNG DER GRIDANSICHT
   ============================================================ */

const SORT_LABELS = {
  name: "Dateiname",
  fileDate: "Dateidatum",
  captureDate: "Aufnahmedatum",
  fileSize: "Dateigröße",
};

/**
 * Sortiert ein Array von PhotoEntry-Objekten IN PLACE nach dem gewählten
 * Kriterium und der Richtung. Dateiname wird "natürlich" sortiert (IMG_2 vor
 * IMG_10), nicht rein lexikografisch - bei Fotodateien mit numerischen Namen
 * ist das die erwartete Reihenfolge. Bei fehlenden Werten (z. B. Datei ohne
 * lesbares Datum) wird der jeweils kleinstmögliche Wert angenommen, damit
 * solche Einträge konsistent an einem Ende landen statt zufällig zu springen.
 * @param {Array} entries
 * @param {'name'|'fileDate'|'captureDate'|'fileSize'} sortKey
 * @param {'asc'|'desc'} sortDirection
 */
function sortPhotoEntries(entries, sortKey, sortDirection) {
  const dir = sortDirection === "desc" ? -1 : 1;

  entries.sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        // Über den Anzeigenamen sortieren, damit beim Einlesen mit Unterordnern
        // die Dateien eines Ordners beieinander stehen statt sich zu vermischen.
        cmp = photoDisplayName(a).localeCompare(photoDisplayName(b), "de", { numeric: true, sensitivity: "base" });
        break;
      case "fileDate":
        cmp = (a.fileDate ? a.fileDate.getTime() : 0) - (b.fileDate ? b.fileDate.getTime() : 0);
        break;
      case "fileSize":
        cmp = (a.fileSize ?? 0) - (b.fileSize ?? 0);
        break;
      case "captureDate":
      default:
        cmp = (a.captureDate ? a.captureDate.getTime() : 0) - (b.captureDate ? b.captureDate.getTime() : 0);
        break;
    }
    return cmp * dir;
  });
}

/**
 * Wendet einen neuen Sortier-Zustand auf das Grid an: sortiert state.photos neu,
 * hält den Cursor auf demselben FOTO (nicht derselben Position) fest, passt die
 * Mehrfachauswahl entsprechend an (Referenzen bleiben über Indizes hinweg
 * gültig, da wir dieselben Objekte nur umordnen) und baut Filter/Grid neu auf.
 */
function applySorting(sortKey, sortDirection) {
  const previousCursorEntry = state.cursorIndex !== -1 ? state.photos[state.cursorIndex] : null;
  const previousSelectedEntries = new Set(
    Array.from(state.selectedIndices).map((i) => state.photos[i])
  );

  state.sortKey = sortKey;
  state.sortDirection = sortDirection;
  sortPhotoEntries(state.photos, sortKey, sortDirection);

  // Cursor und Auswahl anhand der ZUVOR gemerkten Objekte auf ihre neuen
  // Positionen im umsortierten Array ummünzen - das Foto bleibt "ausgewählt",
  // auch wenn sich seine Position durch die Sortierung verschoben hat.
  if (previousCursorEntry) {
    const newIndex = state.photos.indexOf(previousCursorEntry);
    state.cursorIndex = newIndex; // -1 nur, falls das Foto zwischenzeitlich entfernt wurde
  }
  state.selectedIndices = new Set(
    Array.from(previousSelectedEntries)
      .map((entry) => state.photos.indexOf(entry))
      .filter((i) => i !== -1)
  );

  renderGrid();
  updateBottomBar();
  updateSortControlsUI();
}

function updateSortControlsUI() {
  const select = document.getElementById("sortKeySelect");
  const dirBtn = document.getElementById("btnSortDirection");
  if (select) select.value = state.sortKey;
  if (dirBtn) {
    dirBtn.textContent = state.sortDirection === "asc" ? "↑ Aufsteigend" : "↓ Absteigend";
    dirBtn.setAttribute("aria-label", state.sortDirection === "asc" ? "Aufsteigend sortiert" : "Absteigend sortiert");
  }
}

const sortKeySelectEl = document.getElementById("sortKeySelect");
const sortDirectionBtnEl = document.getElementById("btnSortDirection");
if (sortKeySelectEl) {
  sortKeySelectEl.addEventListener("change", () => {
    applySorting(sortKeySelectEl.value, state.sortDirection);
  });
}
if (sortDirectionBtnEl) {
  sortDirectionBtnEl.addEventListener("click", () => {
    applySorting(state.sortKey, state.sortDirection === "asc" ? "desc" : "asc");
  });
}

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
    if (THUMBNAILABLE_EXTENSIONS.has(entry.ext)) {
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
      entry.thumbFailed = true; // RAW ohne einbettbares Vorschaubild -> grauer Kasten
    }
  } catch (e) {
    // Fallback: falls Downscaling scheitert (z.B. HEIC vom Browser nicht decodierbar),
    // Originaldatei direkt verwenden statt komplett auf "keine Vorschau" zu gehen.
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

/* ============================================================
   FILTERUNG NACH AKTION
   ============================================================ */

/** Prüft, ob ein Foto (per Index) zum aktuell aktiven Filter passt. */
function matchesActiveFilter(index) {
  const entry = state.photos[index];
  if (!entry) return false;
  switch (state.activeFilter) {
    case "move": return entry.action === "move";
    case "delete": return entry.action === "delete";
    case "none": return entry.action === "none";
    case "hasKeywords": return entry.assignedKeywords.length > 0;
    case "noKeywords": return entry.assignedKeywords.length === 0;
    default: return true; // 'all'
  }
}

/**
 * Liste der Indizes, die beim aktuellen Filter sichtbar sind, in Anzeigereihenfolge.
 * Wird nach jeder Aktionsänderung und jedem Filterwechsel neu aufgebaut, damit
 * Navigation (Pfeiltasten, "alle auswählen") ausschließlich auf sichtbaren Fotos
 * operiert und keine ausgeblendeten Fotos überspringt oder mitzählt.
 */
let visibleIndices = [];
/** Kehrindex: Foto-Index -> Position in visibleIndices, für O(1)-Lookup statt indexOf(). */
let visiblePositionByIndex = new Map();

function rebuildVisibleIndices() {
  visibleIndices = [];
  visiblePositionByIndex = new Map();
  for (let i = 0; i < state.photos.length; i++) {
    if (matchesActiveFilter(i)) {
      visiblePositionByIndex.set(i, visibleIndices.length);
      visibleIndices.push(i);
    }
  }
}

/** Position eines Foto-Index innerhalb der sichtbaren Liste, oder -1 falls ausgeblendet. */
function positionInVisible(index) {
  const pos = visiblePositionByIndex.get(index);
  return pos === undefined ? -1 : pos;
}

/**
 * Wechselt den aktiven Filter, baut die sichtbare Menge neu auf und hält den
 * Cursor auf einer sinnvollen Position (möglichst nah an der bisherigen Stelle
 * innerhalb der neuen sichtbaren Menge).
 */
function setActiveFilter(filter) {
  if (state.activeFilter === filter) return;

  const oldPos = positionInVisible(state.cursorIndex);
  state.activeFilter = filter;
  state.selectedIndices.clear(); // Mehrfachauswahl über einen Filterwechsel hinweg fortzusetzen wäre verwirrend
  rebuildVisibleIndices();
  updateAllCellStates();
  relocateCursorAfterFilterChange(oldPos === -1 ? 0 : oldPos);
  updateFilterEmptyState();
  updateFilterButtonsUI();
  updateBottomBar();
  invalidateColumnCountCache(); // Zeilenumbruch kann sich durch weniger sichtbare Zellen ändern
}

function updateFilterButtonsUI() {
  document.querySelectorAll(".filterBtn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === state.activeFilter);
  });
}

document.getElementById("filterGroup").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".filterBtn");
  if (!btn) return;
  setActiveFilter(btn.dataset.filter);
  gridWrap.focus(); // Tastaturnavigation soll nach Filterwechsel sofort weiter funktionieren
});

/* ============================================================
   GRID RENDERING
   ============================================================ */

/** Cache: Index -> { root, thumbBox, badge, checkbox } für O(1)-Zugriff ohne querySelector */
let cellElements = [];

/** Zustand für Quick Look (Ganzes-Foto-Overlay im Grid) - hier deklariert, da renderGrid() bereits darauf zugreift. */
let quickLookVisible = false;
let quickLookIndex = -1;

/** Zustand für die Lupe im Leuchtkasten - hier deklariert, da openLightbox() bereits darauf zugreift. */
let loupeActive = false;

function renderGrid() {
  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("emptyState");
  grid.innerHTML = "";
  cellElements = [];
  resetThumbnailLoading();
  invalidateColumnCountCache();
  rebuildVisibleIndices();

  if (state.photos.length === 0) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  const fragment = document.createDocumentFragment();
  state.photos.forEach((entry, index) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = String(index);
    cell.tabIndex = -1;

    cell.innerHTML = `
      <div class="checkbox"></div>
      <div class="thumbBox">${entry.thumbUrl ? "" : `<div class="noThumb">…</div>`}</div>
      <div class="fname">${escapeHtml(photoDisplayName(entry))}</div>
      <div class="badge"></div>
      <div class="keywordIndicator"></div>
      <div class="keywordChipsRow"></div>
    `;

    const thumbBox = cell.querySelector(".thumbBox");
    const badge = cell.querySelector(".badge");
    const checkbox = cell.querySelector(".checkbox");
    const keywordIndicator = cell.querySelector(".keywordIndicator");
    const keywordChipsRow = cell.querySelector(".keywordChipsRow");

    if (entry.thumbUrl) {
      const img = document.createElement("img");
      img.src = entry.thumbUrl;
      img.alt = entry.name;
      thumbBox.innerHTML = "";
      thumbBox.appendChild(img);
    } else if (entry.thumbFailed) {
      thumbBox.innerHTML = `<div class="noThumb">Keine<br>Vorschau<br>${escapeHtml(entry.ext.toUpperCase())}</div>`;
    }

    cell.addEventListener("click", (ev) => onCellClick(index, ev));
    cell.addEventListener("dblclick", () => openLightbox(index));

    cellElements[index] = { root: cell, thumbBox, badge, checkbox, keywordIndicator, keywordChipsRow };
    fragment.appendChild(cell);
  });
  grid.appendChild(fragment);

  // Sichtbarkeit erst nach dem Einfügen ins DOM beobachten (sonst falsche Bounding-Rects)
  state.photos.forEach((entry, index) => {
    if (!entry.thumbUrl && !entry.thumbFailed) {
      thumbObserver.observe(cellElements[index].root);
    }
  });

  updateAllCellStates();
  updateFilterEmptyState();
  closeGridExifOverlay(); // Zell-Referenzen werden gerade neu aufgebaut - Overlay-Position wäre nicht mehr gültig
  if (quickLookVisible) closeQuickLook(); // referenzierter Index könnte durch Sortierung/Filterwechsel nicht mehr stimmen
}

/**
 * Aktualisiert die Optik ALLER Zellen. Nur nach Vollständig-Änderungen aufrufen
 * (z.B. neues Verzeichnis geladen). Für Cursor-/Selektionswechsel bitte
 * updateCellVisualState() gezielt auf die betroffenen Indizes anwenden.
 */
function updateAllCellStates() {
  for (let index = 0; index < state.photos.length; index++) {
    updateCellVisualState(index);
  }
}

function updateCellVisualState(index) {
  const refs = cellElements[index];
  if (!refs) return;
  const entry = state.photos[index];
  const cell = refs.root;

  const isVisible = matchesActiveFilter(index);
  cell.classList.toggle("filtered-out", !isVisible);

  cell.classList.toggle("cursor", index === state.cursorIndex);
  const isSelected = state.selectedIndices.has(index);
  cell.classList.toggle("selected", isSelected);
  cell.classList.toggle("checked", isSelected);
  cell.classList.remove("action-move", "action-delete");

  if (entry.action === "move") {
    cell.classList.add("action-move");
    refs.badge.textContent = "VERSCHIEBEN";
  } else if (entry.action === "delete") {
    cell.classList.add("action-delete");
    refs.badge.textContent = "LÖSCHEN";
  } else {
    refs.badge.textContent = "";
  }

  renderCellKeywords(refs, entry);
}

/**
 * Zeigt die zugewiesenen Stichworte einer Zelle an: ein Tag-Indikator (nur
 * sichtbar, wenn mindestens ein Stichwort zugewiesen ist) sowie eine kompakte
 * Chip-Reihe mit maximal 3 Labels plus "+N"-Zähler für den Rest. Bei kleinen
 * Thumbnails ist damit auf einen Blick erkennbar, DASS und WELCHE Stichworte
 * ein Foto bereits hat, ohne dass ein Klick/Hover nötig wäre.
 */
function renderCellKeywords(refs, entry) {
  const kws = entry.assignedKeywords;
  refs.keywordIndicator.classList.toggle("hasKeywords", kws.length > 0);

  // Stichworte, die schon in der Datei stehen, aber noch nicht übernommen wurden:
  // als eigener, zurückhaltender Chip anzeigen. Ohne diesen Hinweis müsste man
  // jedes Foto einzeln öffnen, um überhaupt zu erfahren, dass es welche mitbringt.
  const vorhandenNichtUebernommen = (entry.existingKeywords || [])
    .filter((label) => !kws.includes(label)).length;

  if (kws.length === 0 && vorhandenNichtUebernommen === 0) {
    refs.keywordChipsRow.innerHTML = "";
    refs.keywordChipsRow.classList.add("hidden");
    return;
  }
  refs.keywordChipsRow.classList.remove("hidden");

  if (kws.length === 0) {
    refs.keywordChipsRow.innerHTML =
      `<span class="miniKwChip miniKwChipExisting" title="Im Foto vorhandene Stichworte – mit Taste T übernehmen">` +
      `📄 ${vorhandenNichtUebernommen}</span>`;
    return;
  }

  const MAX_VISIBLE = 3;
  const visible = kws.slice(0, MAX_VISIBLE);
  const rest = kws.length - visible.length;

  let html = visible.map((label) => `<span class="miniKwChip">${escapeHtml(label)}</span>`).join("");
  if (rest > 0) html += `<span class="miniKwChip miniKwChipMore">+${rest}</span>`;
  if (vorhandenNichtUebernommen > 0) {
    html += `<span class="miniKwChip miniKwChipExisting" title="Weitere im Foto vorhandene Stichworte – mit Taste T übernehmen">` +
      `📄 ${vorhandenNichtUebernommen}</span>`;
  }
  refs.keywordChipsRow.innerHTML = html;
}

/** Zeigt/versteckt den "keine Treffer"-Hinweis, je nachdem ob der aktive Filter Fotos zeigt. */
function updateFilterEmptyState() {
  const el = document.getElementById("filterEmptyState");
  const showHint = state.photos.length > 0 && visibleIndices.length === 0;
  el.classList.toggle("hidden", !showHint);
}

function onCellClick(index, ev) {
  const touchedIndices = new Set([index, state.cursorIndex]);

  if (ev.shiftKey && state.cursorIndex !== -1 && positionInVisible(state.cursorIndex) !== -1) {
    // Bereich auswählen, aber nur unter den aktuell SICHTBAREN Fotos (bei aktivem
    // Filter dürfen ausgeblendete Fotos "dazwischen" nicht unsichtbar mitmarkiert werden)
    const anchorPos = positionInVisible(state.cursorIndex);
    const clickedPos = positionInVisible(index);
    if (clickedPos !== -1) {
      const startPos = Math.min(anchorPos, clickedPos);
      const endPos = Math.max(anchorPos, clickedPos);
      for (let p = startPos; p <= endPos; p++) {
        const i = visibleIndices[p];
        state.selectedIndices.add(i);
        touchedIndices.add(i);
      }
    }
    updateCursorOnly(index, false, touchedIndices);
  } else if (ev.ctrlKey || ev.metaKey) {
    if (state.selectedIndices.has(index)) {
      state.selectedIndices.delete(index);
    } else {
      state.selectedIndices.add(index);
    }
    updateCursorOnly(index, false, touchedIndices);
  } else {
    // Vorherige Auswahl muss optisch zurückgesetzt werden -> deren Indizes mitnehmen
    state.selectedIndices.forEach((i) => touchedIndices.add(i));
    state.selectedIndices.clear();
    updateCursorOnly(index, true, touchedIndices);
  }
  updateBottomBar();
}

/**
 * Setzt den Cursor und aktualisiert NUR die übergebenen (betroffenen) Zellen optisch,
 * statt das gesamte Grid neu zu berechnen. Das ist bei vielen hundert/tausend Fotos
 * der entscheidende Performance-Unterschied gegenüber updateAllCellStates().
 */
function updateCursorOnly(index, clearSelection, touchedIndices) {
  if (index < 0 || index >= state.photos.length) return;
  state.cursorIndex = index;
  if (clearSelection) state.selectedIndices.clear();
  touchedIndices.forEach((i) => updateCellVisualState(i));
  scrollCellIntoView(index);
  refreshGridExifOverlayIfVisible();
}

/**
 * Scrollt die Zelle nur dann in den sichtbaren Bereich, wenn sie tatsächlich
 * oberhalb oder unterhalb des aktuellen Sichtfelds liegt. Im Gegensatz zu
 * element.scrollIntoView() wird bei einer bereits sichtbaren Zelle (z. B. beim
 * Navigieren innerhalb einer sichtbaren Zeile mit Pfeil links/rechts) gar kein
 * Scroll-Vorgang ausgelöst.
 */
function scrollCellIntoView(index) {
  const refs = cellElements[index];
  if (!refs) return;
  const cell = refs.root;
  const wrap = gridWrap;

  const wrapTop = wrap.scrollTop;
  const wrapBottom = wrapTop + wrap.clientHeight;
  const cellTop = cell.offsetTop;
  const cellBottom = cellTop + cell.offsetHeight;

  if (cellTop < wrapTop) {
    wrap.scrollTop = cellTop;
  } else if (cellBottom > wrapBottom) {
    wrap.scrollTop = cellBottom - wrap.clientHeight;
  }
}

/* ============================================================
   TASTATURNAVIGATION IM GRID
   ============================================================ */

const gridWrap = document.getElementById("gridWrap");

gridWrap.addEventListener("keydown", (ev) => {
  if (state.photos.length === 0) return;

  // Strg/Cmd+A ist das einzige Kürzel mit Modifikator - separat vor der Weiche.
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "a" || ev.key === "A")) {
    ev.preventDefault();
    selectAll();
    return;
  }
  // Alle übrigen Kürzel sind einzelne Tasten. Ohne diese Sperre würde z.B.
  // Strg+V (einfügen) Fotos zum Verschieben und Strg+L (Adresszeile) Fotos zum
  // LÖSCHEN markieren, und Strg+1..9 den Tab-Wechsel abfangen - jeweils inkl.
  // preventDefault(), sodass der Browser seine eigene Aktion nicht mehr ausführt.
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

  switch (ev.key) {
    case "ArrowRight":
      ev.preventDefault();
      moveCursor(1, ev.shiftKey);
      break;
    case "ArrowLeft":
      ev.preventDefault();
      moveCursor(-1, ev.shiftKey);
      break;
    case "ArrowDown":
      ev.preventDefault();
      moveCursor(getCachedColumnCount(), ev.shiftKey);
      break;
    case "ArrowUp":
      ev.preventDefault();
      moveCursor(-getCachedColumnCount(), ev.shiftKey);
      break;
    case "v":
    case "V":
      ev.preventDefault();
      applyActionToSelection("move");
      break;
    case "l":
    case "L":
      ev.preventDefault();
      applyActionToSelection("delete");
      break;
    case "x":
    case "X":
      ev.preventDefault();
      applyActionToSelection("none");
      break;
    case " ": {
      ev.preventDefault();
      // Bei aktiver Mehrfachauswahl bleibt Leertaste die Auswahl-Toggle-Funktion
      // (wird dort gebraucht, um einzelne Fotos hinzuzufügen/zu entfernen).
      // Bei Einzelauswahl (nur der Cursor, keine Mehrfachauswahl) öffnet Leertaste
      // stattdessen Quick Look - konsistent mit macOS Quick Look und mit dem
      // bereits etablierten Verhalten des I-Shortcuts (Bildinformationen).
      const isMultiSelect = state.selectedIndices.size > 1
        || (state.selectedIndices.size === 1 && !state.selectedIndices.has(state.cursorIndex));
      if (isMultiSelect) {
        toggleSelectionAtCursor();
      } else if (state.cursorIndex !== -1) {
        openQuickLook(state.cursorIndex);
      }
      break;
    }
    case "Enter":
      ev.preventDefault();
      if (state.cursorIndex !== -1) openLightbox(state.cursorIndex);
      break;
    case "t":
    case "T":
      ev.preventDefault();
      openKeywordAssignPanel();
      break;
    case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9":
      ev.preventDefault();
      applyFavoriteToSelection(Number(ev.key) - 1);
      break;
    case "i":
    case "I":
      ev.preventDefault();
      toggleGridExifOverlay();
      break;
    case "Escape":
      if (gridExifVisible) {
        ev.preventDefault();
        closeGridExifOverlay();
      }
      break;
  }
});

let cachedColumnCount = null;

/**
 * Liefert die aktuelle Spaltenanzahl des Grids, aus einem Cache. Die teure
 * Berechnung (getComputedStyle erzwingt einen Layout-Reflow) läuft nur einmal
 * pro Grid-Aufbau bzw. Fenster-Resize, nicht bei jedem Tastendruck.
 */
function getCachedColumnCount() {
  if (cachedColumnCount == null) {
    cachedColumnCount = computeGridColumnCount();
  }
  return cachedColumnCount;
}

function invalidateColumnCountCache() {
  cachedColumnCount = null;
}

function computeGridColumnCount() {
  const grid = document.getElementById("grid");
  const gridStyles = window.getComputedStyle(grid);
  const columnCount = gridStyles.getPropertyValue("grid-template-columns").split(" ").length;
  return columnCount || 1;
}

let resizeDebounceTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(invalidateColumnCountCache, 150);
  closeGridExifOverlay();
});
gridWrap.addEventListener("scroll", () => closeGridExifOverlay(), { passive: true });

/* ============================================================
   QUICK LOOK (Ganzes Foto, Leertaste bei Einzelauswahl im Grid)
   ============================================================
   Reine Bildvorschau ohne Steuerelemente - schneller Blick aufs volle Foto,
   ohne den vollen Leuchtkasten (mit Panel/Filmstreifen) zu öffnen. Nutzt
   dieselbe Großbild-Lade-Infrastruktur (entry.largePreviewUrl / loadLargePreview)
   wie der Leuchtkasten, aber ein eigenes <img>-Element - beide Overlays
   funktionieren unabhängig voneinander. Zustand (quickLookVisible/-Index)
   ist bereits weiter oben deklariert, da renderGrid() bereits darauf zugreift.
   ============================================================ */

function openQuickLook(index) {
  const entry = state.photos[index];
  if (!entry) return;
  quickLookVisible = true;
  quickLookIndex = index;
  document.getElementById("quickLookOverlay").classList.remove("hidden");
  renderQuickLookImage(entry);
}

function closeQuickLook() {
  quickLookVisible = false;
  quickLookIndex = -1;
  document.getElementById("quickLookOverlay").classList.add("hidden");
}

async function renderQuickLookImage(entry) {
  const wrap = document.getElementById("quickLookImgWrap");

  // Sofort das bereits vorhandene (kleine oder ggf. schon geladene große) Bild zeigen,
  // damit Quick Look ohne Wartezeit reagiert - danach ggf. auf die große Vorschau nachschärfen.
  renderQuickLookImageElement(entry, wrap);

  if (THUMBNAILABLE_EXTENSIONS.has(entry.ext) && !entry.largePreviewUrl) {
    const myIndex = quickLookIndex;
    await loadLargePreview(entry);
    if (!quickLookVisible || quickLookIndex !== myIndex) return; // währenddessen geschlossen
    renderQuickLookImageElement(entry, wrap);
  } else if (entry.largePreviewUrl) {
    touchLargePreview(entry); // bereits geladen: als zuletzt benutzt markieren, nicht verdrängen
  }
}

function renderQuickLookImageElement(entry, wrap) {
  const showUrl = entry.largePreviewUrl || entry.thumbUrl;
  wrap.innerHTML = "";
  if (showUrl) {
    const img = document.createElement("img");
    img.src = showUrl;
    img.alt = entry.name;
    wrap.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "noThumbLarge";
    placeholder.textContent = entry.thumbFailed
      ? `Keine Vorschau verfügbar (${entry.ext.toUpperCase()})`
      : "Lädt…";
    wrap.appendChild(placeholder);
  }
}

document.getElementById("quickLookOverlay").addEventListener("click", closeQuickLook);

document.addEventListener("keydown", (ev) => {
  if (quickLookVisible && ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    closeQuickLook();
  }
}, true);

/**
 * Setzt den Cursor auf einen Index und aktualisiert dabei nur die alte und
 * die neue Cursor-Zelle (statt des gesamten Grids) – wichtig für Performance
 * bei vielen hundert/tausend Fotos.
 */
function setCursor(index, clearSelection) {
  if (index < 0 || index >= state.photos.length) return;
  const touched = new Set([index, state.cursorIndex]);
  if (clearSelection) {
    state.selectedIndices.forEach((i) => touched.add(i));
    state.selectedIndices.clear();
  }
  state.cursorIndex = index;
  touched.forEach((i) => updateCellVisualState(i));
  scrollCellIntoView(index);
  refreshGridExifOverlayIfVisible();
}

/**
 * Bewegt den Cursor um `delta` Schritte innerhalb der aktuell SICHTBAREN Fotos
 * (visibleIndices), nicht linear über state.photos. Das ist entscheidend bei
 * aktivem Filter: ausgeblendete Fotos dürfen weder angesteuert noch übersprungen
 * werden, als wären sie nicht da – die Positionsrechnung muss auf der sichtbaren
 * Menge erfolgen, sonst würde z. B. Pfeil-runter bei aktivem Filter unregelmäßig
 * viele oder zu wenige Positionen springen.
 */
function moveCursor(delta, extendSelection) {
  if (visibleIndices.length === 0) return;

  if (state.cursorIndex === -1 || positionInVisible(state.cursorIndex) === -1) {
    setCursor(visibleIndices[0], true);
    updateBottomBar();
    return;
  }

  const currentPos = positionInVisible(state.cursorIndex);
  const newPos = Math.max(0, Math.min(visibleIndices.length - 1, currentPos + delta));
  const newIndex = visibleIndices[newPos];

  if (extendSelection) {
    // Bereichsauswahl erweitern zwischen bisherigem Cursor und neuem, nur über
    // sichtbare Fotos (Positionen in visibleIndices, nicht rohe Foto-Indizes)
    const anchorPos = currentPos;
    const touched = new Set(state.selectedIndices); // alte Auswahl muss ggf. optisch zurückgesetzt werden
    state.selectedIndices.clear();
    const startPos = Math.min(anchorPos, newPos);
    const endPos = Math.max(anchorPos, newPos);
    for (let p = startPos; p <= endPos; p++) {
      const i = visibleIndices[p];
      state.selectedIndices.add(i);
      touched.add(i);
    }
    touched.add(state.cursorIndex);
    touched.add(newIndex);
    state.cursorIndex = newIndex;
    touched.forEach((i) => updateCellVisualState(i));
    scrollCellIntoView(newIndex);
    refreshGridExifOverlayIfVisible();
  } else {
    setCursor(newIndex, true);
  }
  updateBottomBar();
}

function toggleSelectionAtCursor() {
  if (state.cursorIndex === -1) return;
  if (state.selectedIndices.has(state.cursorIndex)) {
    state.selectedIndices.delete(state.cursorIndex);
  } else {
    state.selectedIndices.add(state.cursorIndex);
  }
  updateCellVisualState(state.cursorIndex);
  refreshGridExifOverlayIfVisible();
  updateBottomBar();
}

/** Wählt alle aktuell SICHTBAREN Fotos aus (ausgeblendete/gefilterte bleiben unberührt). */
function selectAll() {
  state.selectedIndices.clear();
  for (const i of visibleIndices) state.selectedIndices.add(i);
  updateAllCellStates();
  refreshGridExifOverlayIfVisible();
  updateBottomBar();
}

/**
 * Wendet eine Aktion auf die aktuelle Auswahl an (oder auf den Cursor, wenn keine
 * Mehrfachauswahl aktiv ist). Führt die Aktionszähler inkrementell mit, damit
 * updateBottomBar() nicht bei jedem Tastendruck alle Fotos neu durchzählen muss.
 */
function applyActionToSelection(action) {
  const targets = getEffectiveTargetIndices();
  if (targets.length === 0) return;

  // Merken, wo der Cursor gerade steht, bevor sich durch den Filter ggf. alles verschiebt
  const cursorPosBefore = positionInVisible(state.cursorIndex);

  targets.forEach((i) => {
    const entry = state.photos[i];
    if (entry.action === "move") actionCounts.move--;
    else if (entry.action === "delete") actionCounts.delete--;
    entry.action = action;
    if (action === "move") actionCounts.move++;
    else if (action === "delete") actionCounts.delete++;
  });

  if (state.activeFilter !== "all") {
    // Bei aktivem Filter können Fotos durch die neue Aktion aus der sichtbaren
    // Menge herausfallen (z. B. Filter "Unmarkiert" + gerade markiert) -> Liste
    // der sichtbaren Fotos neu aufbauen und alle Zellen (Sichtbarkeit!) aktualisieren.
    rebuildVisibleIndices();
    updateAllCellStates();
    relocateCursorAfterFilterChange(cursorPosBefore);
    updateFilterEmptyState();
  } else {
    targets.forEach((i) => updateCellVisualState(i));
  }

  updateBottomBar();
}

/**
 * Nach einer Filteränderung oder einer Aktion, die Fotos aus der sichtbaren Menge
 * entfernt hat: hält den Cursor an einer sinnvollen Position innerhalb der weiterhin
 * sichtbaren Fotos, statt dass er auf ein jetzt ausgeblendetes Foto zeigt.
 */
function relocateCursorAfterFilterChange(preferredPos) {
  if (visibleIndices.length === 0) {
    state.cursorIndex = -1;
    return;
  }
  const clampedPos = Math.max(0, Math.min(visibleIndices.length - 1, preferredPos));
  const newIndex = visibleIndices[clampedPos];
  const touched = new Set([newIndex]);
  state.selectedIndices.forEach((i) => touched.add(i));
  state.cursorIndex = newIndex;
  touched.forEach((i) => updateCellVisualState(i));
  scrollCellIntoView(newIndex);
}

function getEffectiveTargetIndices() {
  if (state.selectedIndices.size > 0) {
    return Array.from(state.selectedIndices);
  }
  if (state.cursorIndex !== -1) return [state.cursorIndex];
  return [];
}

/* ============================================================
   STICHWORT-ZUWEISUNG ZU FOTOS
   (Kernfunktionen sind bewusst UI-neutral gehalten - nur die abschließenden
   *Selection-Wrapper wissen etwas vom Grid. So kann der Leuchttisch später
   dieselben Kernfunktionen mit einer eigenen Zielbestimmung aufrufen.)
   ============================================================ */

/**
 * Fügt einem Foto ein Stichwort-Label hinzu, falls es noch nicht vorhanden ist.
 * Gibt true zurück, wenn sich etwas geändert hat (für Toggle-Logik nützlich).
 */
function addKeywordToPhoto(index, label) {
  const entry = state.photos[index];
  if (!entry || !label) return false;
  if (entry.assignedKeywords.includes(label)) return false;
  entry.assignedKeywords.push(label);
  return true;
}

/** Entfernt ein Stichwort-Label von einem Foto, falls vorhanden. Gibt true zurück, wenn entfernt wurde. */
function removeKeywordFromPhoto(index, label) {
  const entry = state.photos[index];
  if (!entry) return false;
  const before = entry.assignedKeywords.length;
  entry.assignedKeywords = entry.assignedKeywords.filter((l) => l !== label);
  return entry.assignedKeywords.length !== before;
}

/**
 * Wendet ein Stichwort-Label auf mehrere Fotos an (Toggle: ist es bei der
 * MEHRHEIT der Ziele schon gesetzt, wird es entfernt, sonst überall gesetzt -
 * konsistent mit dem Verhalten "erneutes Drücken entfernt wieder").
 */
function toggleKeywordOnTargets(targets, label) {
  if (targets.length === 0 || !label) return;
  const setCount = targets.filter((i) => state.photos[i].assignedKeywords.includes(label)).length;
  const shouldRemove = setCount === targets.length; // nur entfernen, wenn WIRKLICH alle es schon haben
  targets.forEach((i) => {
    if (shouldRemove) removeKeywordFromPhoto(i, label);
    else addKeywordToPhoto(i, label);
  });
}

/** Wendet mehrere Stichwort-Labels (z. B. ein ganzes Set/Gruppe) auf mehrere Fotos an - immer HINZUFÜGEN, kein Toggle. */
function addKeywordsToTargets(targets, labels) {
  targets.forEach((i) => labels.forEach((label) => addKeywordToPhoto(i, label)));
}

/** Entfernt mehrere Stichwort-Labels von mehreren Fotos (z. B. ein ganzes Set/Gruppe wieder abwählen). */
function removeKeywordsFromTargets(targets, labels) {
  targets.forEach((i) => labels.forEach((label) => removeKeywordFromPhoto(i, label)));
}

/* ---- Grid-spezifische Wrapper: wirken auf Cursor/Mehrfachauswahl, aktualisieren die UI ---- */

/**
 * Aktualisiert nach einer Stichwort-Änderung die betroffenen Zellen. Ist ein
 * Stichwort-Filter aktiv ("Mit Stichworten" / "Ohne Stichworte"), kann sich die
 * sichtbare Menge durch die Änderung verschieben - dann muss die komplette
 * Sichtbarkeits-Liste neu aufgebaut werden, sonst bleiben Fotos fälschlich
 * sichtbar oder verschwinden nicht, obwohl sie jetzt aus dem Filter herausfallen.
 */
function refreshAfterKeywordChange(targets) {
  if (state.activeFilter === "hasKeywords" || state.activeFilter === "noKeywords") {
    const cursorPosBefore = positionInVisible(state.cursorIndex);
    rebuildVisibleIndices();
    updateAllCellStates();
    relocateCursorAfterFilterChange(cursorPosBefore === -1 ? 0 : cursorPosBefore);
    updateFilterEmptyState();
  } else {
    targets.forEach((i) => updateCellVisualState(i));
  }
  updateBottomBar();
}

/** Favoriten-Taste 1-9: weist das jeweilige Stichwort per Toggle der aktuellen Grid-Auswahl zu. */
function applyFavoriteToSelection(slotIndex) {
  const fav = getCatalog().favorites[slotIndex];
  if (!fav) {
    showToast(`Favorit ${slotIndex + 1} ist nicht belegt. Im Stichwortkatalog einrichten.`, "info", 3000);
    return;
  }
  const label = favoriteLabel(fav);
  const targets = getEffectiveTargetIndices();
  if (targets.length === 0) return;
  toggleKeywordOnTargets(targets, label);
  refreshAfterKeywordChange(targets);
}

/** Weist ein einzelnes Stichwort (aus dem Zuweisungs-Panel gewählt) der aktuellen Grid-Auswahl per Toggle zu. */
function applyKeywordLabelToSelection(label) {
  const targets = getEffectiveTargetIndices();
  if (targets.length === 0) return;
  toggleKeywordOnTargets(targets, label);
  refreshAfterKeywordChange(targets);
}

/** Weist alle Stichworte einer Gruppe/eines Sets der aktuellen Grid-Auswahl zu (immer hinzufügen, kein Toggle). */
function applyContainerToSelection(container) {
  const targets = getEffectiveTargetIndices();
  if (targets.length === 0) return;
  const labels = container.keywordIds.map((kid) => findKeyword(kid)?.label).filter(Boolean);
  if (labels.length === 0) return;
  addKeywordsToTargets(targets, labels);
  refreshAfterKeywordChange(targets);
  showToast(`${labels.length} Stichwort(e) aus „${container.name}“ zugewiesen.`, "success", 2500);
}

/** Entfernt alle Stichworte einer Gruppe/eines Sets wieder von der aktuellen Grid-Auswahl. */
function removeContainerFromSelection(container) {
  const targets = getEffectiveTargetIndices();
  if (targets.length === 0) return;
  const labels = container.keywordIds.map((kid) => findKeyword(kid)?.label).filter(Boolean);
  if (labels.length === 0) return;
  removeKeywordsFromTargets(targets, labels);
  refreshAfterKeywordChange(targets);
}

/* ------------------------------------------------------------
   BEREITS IM FOTO VORHANDENE STICHWORTE (F8)
   ------------------------------------------------------------
   Viele Fotos bringen aus einer früheren Verschlagwortung schon IPTC/XMP-
   Stichworte mit. Sie werden beim Einlesen mitgelesen (readExistingKeywords)
   und hier zur Übernahme angeboten - NICHT automatisch zugewiesen: was in der
   Datei steht, ist eine Aussage des vorherigen Programms, keine des Nutzers.
   Erst die Übernahme macht daraus eine Zuweisung, die dann auch in die
   Zieldatei geschrieben wird.
   ------------------------------------------------------------ */

/**
 * Sammelt die in den Zielfotos vorhandenen Stichworte ein und zählt, auf wie
 * vielen davon jedes vorkommt. Sortiert nach Häufigkeit, dann alphabetisch.
 * @param {number[]} targetIndices
 * @returns {Array<{label: string, count: number, assignedToAll: boolean}>}
 */
function collectExistingKeywords(targetIndices) {
  const counts = new Map();
  for (const i of targetIndices) {
    const entry = state.photos[i];
    if (!entry || !entry.existingKeywords) continue;
    for (const label of entry.existingKeywords) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      assignedToAll: targetIndices.every((i) => state.photos[i].assignedKeywords.includes(label)),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "de"));
}

/**
 * Rendert die gefundenen Stichworte als Chips in einen Container. Ein Klick
 * schaltet das Stichwort für die Zielfotos um (zuweisen/entfernen), der Knopf
 * „Alle übernehmen" weist alle gefundenen auf einmal zu.
 *
 * @param {string} sectionId - Abschnitt, der bei leerem Ergebnis ausgeblendet wird
 * @param {string} rowId - Container für die Chips
 * @param {number[]} targetIndices
 * @param {Function} onChange - wird nach jeder Änderung aufgerufen (Neuzeichnen)
 */
function renderExistingKeywordRow(sectionId, rowId, targetIndices, onChange) {
  const section = document.getElementById(sectionId);
  const row = document.getElementById(rowId);
  const found = collectExistingKeywords(targetIndices);

  section.classList.toggle("hidden", found.length === 0);
  if (found.length === 0) return;

  row.innerHTML = "";
  const notYetAssigned = found.filter((f) => !f.assignedToAll);
  if (notYetAssigned.length > 1) {
    const all = document.createElement("button");
    all.className = "assignContainerChip";
    all.innerHTML = `<span>Alle übernehmen</span><span class="chipCount">${notYetAssigned.length}</span>`;
    all.addEventListener("click", () => {
      addKeywordsToTargets(targetIndices, notYetAssigned.map((f) => f.label));
      onChange();
    });
    row.appendChild(all);
  }

  found.forEach((f) => {
    const chip = document.createElement("button");
    chip.className = "assignContainerChip existingKeywordChip";
    chip.classList.toggle("assigned", f.assignedToAll);
    chip.title = f.assignedToAll ? "Klicken entfernt die Zuweisung wieder" : "Klicken übernimmt das Stichwort";
    // Die Zahl erscheint nur bei Mehrfachauswahl - bei einem einzelnen Foto
    // wäre "1" an jedem Chip reines Rauschen.
    const badge = targetIndices.length > 1 ? `<span class="chipCount">${f.count}</span>` : "";
    chip.innerHTML = `<span>${escapeHtml(f.label)}</span>${badge}`;
    chip.addEventListener("click", () => {
      if (f.assignedToAll) removeKeywordsFromTargets(targetIndices, [f.label]);
      else addKeywordsToTargets(targetIndices, [f.label]);
      onChange();
    });
    row.appendChild(chip);
  });
}

/* ============================================================
   STICHWORT-ZUWEISUNGS-PANEL (Taste T)
   ============================================================ */

function openKeywordAssignPanel() {
  const targets = getEffectiveTargetIndices();
  if (targets.length === 0) {
    showToast("Kein Foto ausgewählt.", "info", 2500);
    return;
  }
  document.getElementById("keywordAssignOverlay").classList.remove("hidden");
  document.getElementById("assignKeywordSearch").value = "";
  renderKeywordAssignPanel();
  document.getElementById("assignKeywordSearch").focus();
}

function closeKeywordAssignPanel() {
  document.getElementById("keywordAssignOverlay").classList.add("hidden");
  gridWrap.focus();
}

document.getElementById("btnKeywordAssignClose").addEventListener("click", closeKeywordAssignPanel);

// Escape schließt das Panel; alle anderen Tasten (auch 1-9, V, L, X) sollen NICHT
// gleichzeitig ans Grid durchgereicht werden, solange das Panel offen ist.
document.getElementById("keywordAssignOverlay").addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeKeywordAssignPanel();
  }
  ev.stopPropagation();
});

/** Zeichnet den kompletten Panel-Inhalt neu (Ziel-Info, Favoriten, Gruppen, Sets, Suchergebnis). */
function renderKeywordAssignPanel() {
  const targets = getEffectiveTargetIndices();
  const infoEl = document.getElementById("keywordAssignTargetInfo");
  infoEl.textContent = targets.length === 1
    ? "Wird auf 1 Foto angewendet."
    : `Wird auf ${targets.length} ausgewählte Fotos angewendet.`;

  renderExistingKeywordRow("assignExistingSection", "assignExistingRow", targets, () => {
    refreshAfterKeywordChange(targets);
    renderKeywordAssignPanel();
  });
  renderAssignFavoritesRow(targets);
  renderAssignContainerRow("assignGroupsRow", getCatalog().groups, targets);
  renderAssignContainerRow("assignSetsRow", getCatalog().sets, targets);
  renderAssignKeywordResults(document.getElementById("assignKeywordSearch").value, targets);
}

function renderAssignFavoritesRow(targets) {
  const row = document.getElementById("assignFavoritesRow");
  row.innerHTML = "";
  getCatalog().favorites.forEach((fav, index) => {
    const btn = document.createElement("button");
    btn.className = "assignFavBtn";
    if (!fav) {
      btn.disabled = true;
      btn.innerHTML = `<span class="favNum">${index + 1}</span><span class="favLabel">–</span>`;
    } else {
      const label = favoriteLabel(fav);
      const allAssigned = targets.every((i) => state.photos[i].assignedKeywords.includes(label));
      btn.classList.toggle("assigned", allAssigned);
      btn.innerHTML = `<span class="favNum">${index + 1}</span><span class="favLabel">${escapeHtml(label)}</span>`;
      btn.addEventListener("click", () => {
        applyFavoriteToSelection(index);
        renderKeywordAssignPanel();
      });
    }
    row.appendChild(btn);
  });
}

/**
 * Rendert Gruppen- oder Sets-Chips als Toggle: ein Klick weist alle Stichworte
 * des Containers den Zielfotos zu; ist der Container bei ALLEN Zielfotos schon
 * vollständig zugewiesen, entfernt ein Klick ihn stattdessen wieder komplett -
 * derselbe Weg zum Zuweisen wie zum Entfernen, wie gefordert.
 */
function renderAssignContainerRow(rowId, containers, targets) {
  const row = document.getElementById(rowId);
  row.innerHTML = "";
  if (containers.length === 0) {
    row.innerHTML = `<div class="assignKeywordEmpty">Noch keine angelegt (im Stichwortkatalog pflegen).</div>`;
    return;
  }
  containers.forEach((container) => {
    const labels = container.keywordIds.map((kid) => findKeyword(kid)?.label).filter(Boolean);
    const chip = document.createElement("button");
    chip.className = "assignContainerChip";
    const fullyAssigned = labels.length > 0 && targets.every((i) =>
      labels.every((label) => state.photos[i].assignedKeywords.includes(label))
    );
    chip.classList.toggle("assigned", fullyAssigned);
    chip.innerHTML = `<span>${escapeHtml(container.name)}</span><span class="chipCount">${labels.length}</span>`;
    chip.addEventListener("click", () => {
      if (fullyAssigned) removeContainerFromSelection(container);
      else applyContainerToSelection(container);
      renderKeywordAssignPanel();
    });
    row.appendChild(chip);
  });
}

document.getElementById("assignKeywordSearch").addEventListener("input", (ev) => {
  renderAssignKeywordResults(ev.target.value, getEffectiveTargetIndices());
});
document.getElementById("assignKeywordSearch").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    const text = ev.target.value.trim();
    if (!text) return;
    // Exakte Übereinstimmung im Katalog? Sonst als neues freies Stichwort verwenden.
    const existing = getCatalog().keywords.find((k) => k.label.toLowerCase() === text.toLowerCase());
    applyKeywordLabelToSelection(existing ? existing.label : text);
    ev.target.value = "";
    renderKeywordAssignPanel();
  }
});

/**
 * Zeigt Suchergebnisse aus dem Katalog-Pool. Jedes Ergebnis ist klickbar (Toggle
 * für die aktuellen Zielfotos) und markiert, ob es bei ALLEN Zielfotos bereits
 * zugewiesen ist. Bei einem Suchtext ohne Katalog-Treffer wird eine Option
 * angeboten, den eingegebenen Text als freies Stichwort zu verwenden.
 */
function renderAssignKeywordResults(filterText, targets) {
  const resultsEl = document.getElementById("assignKeywordResults");
  resultsEl.innerHTML = "";
  const needle = filterText.trim().toLowerCase();
  const catalog = getCatalog();

  const matching = catalog.keywords
    .filter((k) => !needle || k.label.toLowerCase().includes(needle))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));

  if (matching.length === 0 && !needle) {
    resultsEl.innerHTML = `<div class="assignKeywordEmpty">Noch keine Stichworte im Katalog. Tippen + Enter erstellt ein freies Stichwort direkt am Foto.</div>`;
    return;
  }

  matching.forEach((kw) => {
    const allAssigned = targets.every((i) => state.photos[i].assignedKeywords.includes(kw.label));
    const item = document.createElement("div");
    item.className = "assignKeywordItem" + (allAssigned ? " assigned" : "");
    item.innerHTML = `<span>${escapeHtml(kw.label)}</span>${allAssigned ? '<span class="assignedMark">✓ zugewiesen</span>' : ""}`;
    item.addEventListener("click", () => {
      applyKeywordLabelToSelection(kw.label);
      renderKeywordAssignPanel();
    });
    resultsEl.appendChild(item);
  });

  // Freies Stichwort anbieten, wenn der Suchtext keinen exakten Katalog-Treffer hat
  const hasExactMatch = catalog.keywords.some((k) => k.label.toLowerCase() === needle);
  if (needle && !hasExactMatch) {
    const freeItem = document.createElement("div");
    freeItem.className = "assignKeywordItem";
    freeItem.innerHTML = `<span>„${escapeHtml(filterText.trim())}“ als freies Stichwort verwenden</span>`;
    freeItem.addEventListener("click", () => {
      applyKeywordLabelToSelection(filterText.trim());
      document.getElementById("assignKeywordSearch").value = "";
      renderKeywordAssignPanel();
    });
    resultsEl.appendChild(freeItem);
  }
}

/* ============================================================
   BOTTOM BAR / STATUS
   ============================================================ */

/** Inkrementell mitgeführte Zähler, um wiederholtes Durchzählen von state.photos zu vermeiden. */
const actionCounts = { move: 0, delete: 0 };

function recomputeActionCounts() {
  actionCounts.move = 0;
  actionCounts.delete = 0;
  for (const p of state.photos) {
    if (p.action === "move") actionCounts.move++;
    else if (p.action === "delete") actionCounts.delete++;
  }
}

/**
 * Anzahl Fotos mit mindestens einem zugewiesenen Stichwort. Wird bei Bedarf neu
 * gezählt (nicht inkrementell wie actionCounts), da Stichwort-Zuweisungen im
 * Gegensatz zur Cursor-Navigation nicht bei jedem einzelnen Tastendruck anfallen.
 */
function countPhotosWithKeywords() {
  let n = 0;
  for (const p of state.photos) if (p.assignedKeywords.length > 0) n++;
  return n;
}

// Gecachte Referenzen auf die Statusleisten-Elemente (kein wiederholtes getElementById)
const bottomBarEls = {
  total: document.getElementById("totalCount"),
  move: document.getElementById("moveCount"),
  delete: document.getElementById("deleteCount"),
  keyworded: document.getElementById("keywordedCount"),
  multi: document.getElementById("multiSelectCount"),
  runBtn: document.getElementById("btnRunActions"),
  filterActive: document.getElementById("filterActiveIndicator"),
};

const FILTER_LABELS = {
  all: "",
  move: "🔍 Filter: Verschieben",
  delete: "🔍 Filter: Löschen",
  none: "🔍 Filter: Unmarkiert",
  hasKeywords: "🔍 Filter: Mit Stichworten",
  noKeywords: "🔍 Filter: Ohne Stichworte",
};

function updateBottomBar() {
  bottomBarEls.total.textContent = String(state.photos.length);
  bottomBarEls.move.textContent = String(actionCounts.move);
  bottomBarEls.delete.textContent = String(actionCounts.delete);
  bottomBarEls.keyworded.textContent = String(countPhotosWithKeywords());

  bottomBarEls.multi.textContent =
    state.selectedIndices.size > 1 ? `🔲 ${state.selectedIndices.size} ausgewählt` : "";

  bottomBarEls.filterActive.textContent = FILTER_LABELS[state.activeFilter] || "";

  updateRunButtonState();
}

function updateRunButtonState() {
  const hasActions = actionCounts.move > 0 || actionCounts.delete > 0;
  const hasTarget = !!state.targetDirHandle;
  const needsTargetForMove = actionCounts.move > 0;
  bottomBarEls.runBtn.disabled = !hasActions || (needsTargetForMove && !hasTarget);
}

function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

/**
 * Maskiert einen Text für die Einbettung in HTML. Maskiert AUCH beide
 * Anführungszeichen und ist damit nicht nur für Textinhalte, sondern auch für
 * Attributwerte sicher (`value="${escapeHtml(...)}"`) - eine frühere Variante
 * über textContent/innerHTML tat das nicht, wodurch ein Stichwort mit einem
 * Anführungszeichen aus dem Attribut ausbrechen und beliebige weitere Attribute
 * einschleusen konnte.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    entry.largePreviewUrl = await downscaleImageToObjectUrl(file, 1600);
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
  if (entry.ext !== "jpg" && entry.ext !== "jpeg") return entry.largePreviewUrl || entry.thumbUrl;
  try {
    const file = await entry.handle.getFile();
    entry.fullResUrl = await downscaleImageToObjectUrl(file, LOUPE_MAX_EDGE);
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

/* ============================================================
   NAMENSSCHEMA-EINSTELLUNGSDIALOG
   ============================================================ */

const renameModalOverlay = document.getElementById("renameModalOverlay");
const formatBuilder = document.getElementById("formatBuilder");

const TOKEN_LABELS = {
  date: "📅 Datum",
  event: "📝 Ereignis",
  counter: "🔢 Zähler",
  text: "✏️ Freitext",
  sep_underscore: "_",
  sep_dash: "-",
};

function renderFormatBuilder() {
  formatBuilder.innerHTML = "";
  currentFormatTokens.forEach((token, idx) => {
    const chip = document.createElement("div");
    chip.className = "formatToken";
    chip.draggable = true;
    chip.dataset.idx = String(idx);
    chip.innerHTML = `<span>${TOKEN_LABELS[token.type]}</span><button data-remove="${idx}" title="Entfernen">✕</button>`;
    formatBuilder.appendChild(chip);
  });
  updateFormatPreview();
}

formatBuilder.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-remove]");
  if (!btn) return;
  const idx = Number(btn.dataset.remove);
  currentFormatTokens.splice(idx, 1);
  renderFormatBuilder();
});

// Drag&Drop: Bausteine aus der Palette in den Builder ziehen
document.querySelectorAll(".tokenChip").forEach((chip) => {
  chip.addEventListener("dragstart", (ev) => {
    ev.dataTransfer.setData("text/token-type", chip.dataset.token);
  });
});

formatBuilder.addEventListener("dragover", (ev) => ev.preventDefault());
formatBuilder.addEventListener("drop", (ev) => {
  ev.preventDefault();
  const type = ev.dataTransfer.getData("text/token-type");
  if (!type) return;
  currentFormatTokens.push({ type });
  renderFormatBuilder();
});

document.getElementById("counterStart").addEventListener("input", (ev) => {
  currentCounterStart = Number(ev.target.value) || 0;
  updateFormatPreview();
});
document.getElementById("counterDigits").addEventListener("input", (ev) => {
  currentCounterDigits = Number(ev.target.value) || 1;
  updateFormatPreview();
});
document.getElementById("freeText").addEventListener("input", (ev) => {
  currentFreeText = ev.target.value;
  updateFormatPreview();
});

/**
 * Zeichen, die auf gängigen Dateisystemen in Dateinamen unzulässig sind
 * (Windows-Regelsatz, der auch macOS und Linux mit abdeckt) plus Steuerzeichen.
 * Der Schrägstrich ist der gefährlichste davon: die File System Access API weist
 * jeden Namen mit Pfadseparator zurück, und ein Ereignistext wie "Urlaub 2024/25"
 * würde sonst JEDE Datei des Durchgangs scheitern lassen.
 */
const FILENAME_FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Unter Windows reservierte Gerätenamen - als Dateiname (auch mit Endung) unzulässig. */
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** Obergrenze für den Basisnamen; lässt Platz für Endung, "_1"-Suffix und ".xmp". */
const MAX_FILENAME_BASE_LENGTH = 200;

/**
 * Bereitet einen frei eingegebenen Text (Ereignis, Freitext) für die Verwendung
 * als Baustein eines Dateinamens auf: Leerraum wird zu Unterstrichen, unzulässige
 * Zeichen zu Bindestrichen. Wird auch für die Live-Vorschau im Ereignis-Dialog
 * verwendet, damit der Nutzer die Umwandlung VOR dem Start sieht.
 */
function sanitizeEventText(text) {
  return text
    .trim()
    .replace(/\s+/g, "_")
    .replace(FILENAME_FORBIDDEN_CHARS, "-");
}

/**
 * Letzte Instanz für den fertig zusammengesetzten Basisnamen (ohne Endung):
 * entfernt unzulässige Zeichen, führende/abschließende Punkte und Leerzeichen
 * (ein Name wie ".foo" oder "foo." ist je nach Dateisystem versteckt oder
 * unzulässig), begrenzt die Länge und entschärft reservierte Gerätenamen.
 */
function sanitizeFileBaseName(baseName) {
  let name = baseName.replace(FILENAME_FORBIDDEN_CHARS, "-");
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  name = name.replace(/[_-]{2,}/g, (match) => match[0]);
  name = name.replace(/^[_-]+/, "").replace(/[_-]+$/, "");
  if (name.length > MAX_FILENAME_BASE_LENGTH) {
    name = name.slice(0, MAX_FILENAME_BASE_LENGTH).replace(/[_\-.\s]+$/, "");
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) name = `_${name}`;
  return name;
}

/**
 * Baut den Dateinamen (ohne Endung) aus den aktuellen Format-Tokens.
 * @param {Object} ctx - { date: Date, event: string, counter: number, ext: string }
 */
function buildFilename(ctx) {
  const parts = currentFormatTokens.map((token) => {
    switch (token.type) {
      case "date": {
        const d = ctx.date;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}${mm}${dd}`;
      }
      case "event":
        return sanitizeEventText(ctx.event || "");
      case "counter":
        return String(ctx.counter).padStart(currentCounterDigits, "0");
      case "text":
        return sanitizeEventText(currentFreeText || "");
      case "sep_underscore":
        return "_";
      case "sep_dash":
        return "-";
      default:
        return "";
    }
  });
  // Leere Bausteine (z. B. Ereignis oder Freitext ohne Eingabe) einfach zusammenfügen
  // und anschließend überflüssige Trenner bereinigen: keine doppelten Trenner, keine
  // Trenner am Anfang/Ende, falls der davor/danach stehende Baustein leer war.
  let joined = parts.join("");
  joined = joined.replace(/[_-]{2,}/g, (match) => match[0]); // doppelte Trenner -> einer
  joined = joined.replace(/^[_-]+/, "").replace(/[_-]+$/, ""); // Rand-Trenner entfernen
  return sanitizeFileBaseName(joined);
}

function updateFormatPreview() {
  const exampleCtx = {
    date: new Date(),
    event: "Geburtstag_Oma",
    counter: currentCounterStart,
    ext: "jpg",
  };
  const name = buildFilename(exampleCtx);
  document.getElementById("formatPreview").innerHTML =
    `Beispiel: <b>${escapeHtml(name || "(leer)")}.jpg</b>`;
}

document.getElementById("btnRenameSettings").addEventListener("click", () => {
  renderFormatBuilder();
  document.getElementById("counterStart").value = String(currentCounterStart);
  document.getElementById("counterDigits").value = String(currentCounterDigits);
  document.getElementById("freeText").value = currentFreeText;
  refreshPresetSelect();
  renameModalOverlay.classList.remove("hidden");
});

document.getElementById("btnRenameCancel").addEventListener("click", () => {
  renameModalOverlay.classList.add("hidden");
});

document.getElementById("btnRenameSave").addEventListener("click", () => {
  renameModalOverlay.classList.add("hidden");
  showToast("Namensschema übernommen.", "success", 2500);
});

/* ---- Presets ---- */

function refreshPresetSelect() {
  const select = document.getElementById("presetSelect");
  select.innerHTML = `<option value="">– Voreinstellung wählen –</option>`;
  Object.keys(appSettings.presets).forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
  if (appSettings.lastPreset) select.value = appSettings.lastPreset;
}

function loadPresetIntoBuilder(name) {
  const preset = appSettings.presets[name];
  if (!preset) return;
  currentFormatTokens = JSON.parse(JSON.stringify(preset.tokens));
  currentCounterStart = preset.counterStart;
  currentCounterDigits = preset.counterDigits;
  currentFreeText = preset.freeText || "";
}

document.getElementById("presetSelect").addEventListener("change", (ev) => {
  const name = ev.target.value;
  if (!name) return;
  loadPresetIntoBuilder(name);
  renderFormatBuilder();
  document.getElementById("counterStart").value = String(currentCounterStart);
  document.getElementById("counterDigits").value = String(currentCounterDigits);
  document.getElementById("freeText").value = currentFreeText;
  appSettings.lastPreset = name;
  saveSettings(appSettings);
});

document.getElementById("btnSavePreset").addEventListener("click", () => {
  const name = prompt("Name der Voreinstellung:");
  if (!name) return;
  appSettings.presets[name] = {
    tokens: JSON.parse(JSON.stringify(currentFormatTokens)),
    counterStart: currentCounterStart,
    counterDigits: currentCounterDigits,
    freeText: currentFreeText,
  };
  appSettings.lastPreset = name;
  saveSettings(appSettings);
  refreshPresetSelect();
  showToast(`Voreinstellung „${name}“ gespeichert.`, "success");
});

document.getElementById("btnDeletePreset").addEventListener("click", () => {
  const select = document.getElementById("presetSelect");
  const name = select.value;
  if (!name) {
    showToast("Bitte zuerst eine Voreinstellung auswählen.", "info");
    return;
  }
  if (!confirm(`Voreinstellung „${name}“ wirklich löschen?`)) return;
  delete appSettings.presets[name];
  if (appSettings.lastPreset === name) appSettings.lastPreset = null;
  saveSettings(appSettings);
  refreshPresetSelect();
  showToast(`Voreinstellung „${name}“ gelöscht.`, "success");
});

/* ============================================================
   APP-EINSTELLUNGEN: EXPORT / IMPORT
   ============================================================ */

const appSettingsOverlay = document.getElementById("appSettingsOverlay");

document.getElementById("btnAppSettings").addEventListener("click", () => {
  appSettingsOverlay.classList.remove("hidden");
});
document.getElementById("btnAppSettingsClose").addEventListener("click", () => {
  appSettingsOverlay.classList.add("hidden");
});

document.getElementById("btnExportSettings").addEventListener("click", () => {
  const dataStr = JSON.stringify(appSettings, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "foto-importer-einstellungen.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Einstellungen exportiert.", "success");
});

document.getElementById("btnImportSettings").addEventListener("click", () => {
  document.getElementById("importSettingsFile").click();
});

document.getElementById("importSettingsFile").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.presets) {
      throw new Error("Ungültiges Format der Einstellungsdatei.");
    }
    // Importierte Daten stammen aus einer beliebigen Datei - vor der Übernahme
    // auf die erwartete Form bringen (siehe normalizeSettings).
    appSettings = normalizeSettings(parsed);
    saveSettings(appSettings);
    applyDefaultFormatIfNone();
    refreshPresetSelect();
    state.includeSubfolders = appSettings.includeSubfolders;
    includeSubfoldersCheckbox.checked = state.includeSubfolders;
    showToast("Einstellungen erfolgreich importiert.", "success");
  } catch (e) {
    console.error(e);
    showToast("Import fehlgeschlagen: " + e.message, "error");
  } finally {
    ev.target.value = "";
  }
});

/* ============================================================
   AKTIONEN AUSFÜHREN (Verschieben / Löschen)
   ============================================================ */

const eventModalOverlay = document.getElementById("eventModalOverlay");

document.getElementById("btnRunActions").addEventListener("click", () => {
  const moveCount = state.photos.filter((p) => p.action === "move").length;
  const deleteCount = state.photos.filter((p) => p.action === "delete").length;

  if (moveCount === 0 && deleteCount === 0) return;

  if (moveCount > 0) {
    document.getElementById("eventTextInput").value = "";
    updateEventPreview();
    eventModalOverlay.classList.remove("hidden");
    document.getElementById("eventTextInput").focus();
  } else {
    // Nur Löschungen -> keine Ereignisabfrage nötig
    executeActions("");
  }
});

document.getElementById("eventTextInput").addEventListener("input", updateEventPreview);

function updateEventPreview() {
  const raw = document.getElementById("eventTextInput").value;
  const sanitized = sanitizeEventText(raw);
  document.getElementById("eventPreview").innerHTML = sanitized
    ? `Wird im Dateinamen verwendet als: <b>${escapeHtml(sanitized)}</b>`
    : "";
}

document.getElementById("btnEventCancel").addEventListener("click", () => {
  eventModalOverlay.classList.add("hidden");
});

document.getElementById("btnEventOk").addEventListener("click", () => {
  const eventText = document.getElementById("eventTextInput").value;
  eventModalOverlay.classList.add("hidden");
  executeActions(eventText);
});

async function executeActions(eventText) {
  const moveTargets = state.photos.filter((p) => p.action === "move");
  const deleteTargets = state.photos.filter((p) => p.action === "delete");
  const total = moveTargets.length + deleteTargets.length;

  if (total === 0) return;

  if (moveTargets.length > 0 && !state.targetDirHandle) {
    showToast("Bitte zuerst ein Zielverzeichnis wählen.", "error");
    return;
  }

  // Löschen ist der einzige unumkehrbare Schritt in diesem Programm: removeEntry()
  // entfernt die Datei endgültig, die File System Access API kennt keinen Papierkorb.
  // Deshalb hier eine ausdrückliche Rückfrage - das Löschen einer Voreinstellung
  // oder eines Stichworts fragt schließlich auch nach.
  if (deleteTargets.length > 0) {
    const anzahl = deleteTargets.length === 1
      ? "1 Foto wird"
      : `${deleteTargets.length} Fotos werden`;
    const confirmed = confirm(
      `${anzahl} endgültig aus dem Quellverzeichnis gelöscht.\n\n` +
      `Das geschieht OHNE Papierkorb und kann nicht rückgängig gemacht werden.\n\n` +
      `Fortfahren?`
    );
    if (!confirmed) return;
  }

  showProgress(true, "Verarbeite Dateien…", 0, total);
  let done = 0;
  let counter = currentCounterStart;
  const errors = [];
  // Fehlgeschlagene Fotos werden als Objektreferenz festgehalten, nicht über den
  // Dateinamen aus den Fehlertexten zurückgerechnet - ein Name, der zufällig
  // Präfix eines anderen ist, hätte sonst den Fehler dem falschen Foto zugeordnet
  // und ein tatsächlich nicht verarbeitetes Foto aus der Liste entfernt.
  const failedEntries = new Set();
  let verificationFailureCount = 0;

  // Das Dateisystem entscheidet über freie Namen; Reste aus einem früheren
  // Durchgang (ggf. mit anderem Zielverzeichnis) würden nur stören.
  usedTargetNames.clear();

  // 1) Verschieben: kopieren ins Ziel (mit neuem Namen), dann im Quellordner löschen
  for (const entry of moveTargets) {
    try {
      const file = await entry.handle.getFile();
      const date = entry.captureDate || new Date(file.lastModified);
      const baseName = buildFilename({ date, event: eventText, counter });
      const finalName = await ensureUniqueName(state.targetDirHandle, baseName || "foto", entry.ext);
      const finalBaseNameWithoutExt = finalName.slice(0, finalName.lastIndexOf("."));

      // Die Beschreibung ist der UNVERÄNDERTE Ereignistext (nur getrimmt, OHNE die
      // Unterstrich-Ersetzung, die für den Dateinamen verwendet wird) - im Metadatenfeld
      // soll ein normal lesbarer Fließtext stehen, kein dateinamentauglicher String.
      const description = eventText && eventText.trim() ? eventText.trim() : null;
      const hasMetadataToWrite = entry.assignedKeywords.length > 0 || !!description;

      // Metadaten in die Zieldatei schreiben, sofern Stichworte und/oder eine
      // Beschreibung vorliegen. Bei JPEG: Versuch der direkten Einbettung
      // (IPTC+XMP), mit Sicherheits-Fallback auf die unveränderte Originaldatei,
      // falls der Schreib- oder Konsistenz-Check fehlschlägt. Zusätzlich IMMER
      // eine XMP-Sidecar-Datei, unabhängig vom Format und unabhängig davon, ob
      // die Direkteinbettung geklappt hat - das ist der garantiert sichere,
      // formatunabhängige Weg.
      let fileContentToWrite = file;
      let metadataEmbedded = false; // wurden die Metadaten TATSÄCHLICH in die Datei geschrieben?
      if (hasMetadataToWrite && DIRECT_WRITE_EXTENSIONS.has(entry.ext)) {
        const writtenBuffer = await tryWriteKeywordsIntoJpeg(file, entry.assignedKeywords, description);
        if (writtenBuffer) {
          fileContentToWrite = writtenBuffer;
          metadataEmbedded = true;
        } else {
          showToast(
            `Hinweis: Metadaten für „${photoDisplayName(entry)}“ konnten nicht direkt in die Datei geschrieben werden - sie liegen als XMP-Sidecar-Datei bei.`,
            "info",
            5000
          );
        }
      }

      const targetFileHandle = await state.targetDirHandle.getFileHandle(finalName, { create: true });
      const writable = await targetFileHandle.createWritable();
      await writable.write(fileContentToWrite);
      await writable.close();

      if (hasMetadataToWrite) {
        await writeXmpSidecar(state.targetDirHandle, finalBaseNameWithoutExt, entry.assignedKeywords, description);
      }

      // Sicherheitsprüfung: die soeben geschriebene Zieldatei wird aktiv neu vom
      // Dateisystem gelesen und auf Größe, Bilddaten-Integrität (Hash) sowie -
      // falls zutreffend - korrekt eingebettete Metadaten geprüft. NUR wenn das
      // erfolgreich ist, darf die Quelldatei gelöscht werden. Schlägt die Prüfung
      // fehl, wird ein Fehler geworfen (siehe catch unten) - die Quelldatei bleibt
      // in diesem Fall unangetastet und das Foto bleibt mit zurückgesetzter
      // Aktion im Grid sichtbar, statt kommentarlos verloren zu gehen. Die
      // möglicherweise unvollständige/fehlerhafte Zieldatei wird bewusst NICHT
      // automatisch gelöscht (falls die Prüfung selbst fälschlich anschlägt,
      // wäre das riskanter als eine verdächtige Datei stehen zu lassen) - der
      // Nutzer wird stattdessen auf eine manuelle Prüfung hingewiesen.
      // Die Metadaten-Prüfung darf NUR verlangt werden, wenn tatsächlich
      // eingebettet wurde. Andernfalls (Fallback auf die unveränderte
      // Originaldatei plus Sidecar) enthält die Zieldatei erwartungsgemäß keine
      // eingebetteten Stichworte - die Prüfung würde zwangsläufig fehlschlagen und
      // den Verschiebevorgang abbrechen, obwohl dem Nutzer gerade gemeldet wurde,
      // der Sidecar-Weg greife. Die Sidecar-Datei selbst wird unten separat geprüft.
      const verification = await verifyMovedFile(
        state.targetDirHandle,
        finalName,
        fileContentToWrite,
        entry.ext,
        metadataEmbedded ? entry.assignedKeywords : null,
        metadataEmbedded ? description : null
      );
      if (!verification.ok) {
        const err = new Error(
          `Zieldatei-Prüfung fehlgeschlagen: ${verification.reason}. ` +
          `Die Quelldatei wurde NICHT gelöscht. Die Datei „${finalName}“ im Zielverzeichnis sollte manuell geprüft werden.`
        );
        err.isVerificationFailure = true;
        throw err;
      }

      // Liegen die Metadaten (auch) in der Sidecar-Datei, ist sie für alle Formate
      // ohne Direkteinbettung die EINZIGE Quelle - also ebenfalls zurücklesen und
      // prüfen, bevor das Original gelöscht wird.
      if (hasMetadataToWrite) {
        const sidecarCheck = await verifySidecarFile(
          state.targetDirHandle,
          finalBaseNameWithoutExt,
          entry.assignedKeywords,
          description
        );
        if (!sidecarCheck.ok) {
          const err = new Error(
            `Prüfung der XMP-Sidecar-Datei fehlgeschlagen: ${sidecarCheck.reason}. ` +
            `Die Quelldatei wurde NICHT gelöscht.`
          );
          err.isVerificationFailure = true;
          throw err;
        }
      }

      // Den Ordner nehmen, in dem die Datei TATSÄCHLICH liegt - beim Einlesen mit
      // Unterordnern ist das nicht zwingend das Quellverzeichnis.
      await entry.dirHandle.removeEntry(entry.name);

      counter++;
      done++;
      showProgress(true, "Verschiebe Dateien…", done, total, photoDisplayName(entry));
    } catch (e) {
      console.error("Fehler beim Verschieben von", photoDisplayName(entry), e);
      errors.push(`${photoDisplayName(entry)}: ${e.message}`);
      failedEntries.add(entry);
      if (e.isVerificationFailure) verificationFailureCount++;
      done++;
      showProgress(true, "Verschiebe Dateien…", done, total, photoDisplayName(entry));
    }
  }

  // 2) Löschen im Quellverzeichnis
  for (const entry of deleteTargets) {
    try {
      // Den Ordner nehmen, in dem die Datei TATSÄCHLICH liegt - beim Einlesen mit
      // Unterordnern ist das nicht zwingend das Quellverzeichnis.
      await entry.dirHandle.removeEntry(entry.name);
      done++;
      showProgress(true, "Lösche Dateien…", done, total, photoDisplayName(entry));
    } catch (e) {
      console.error("Fehler beim Löschen von", photoDisplayName(entry), e);
      errors.push(`${photoDisplayName(entry)}: ${e.message}`);
      failedEntries.add(entry);
      done++;
      showProgress(true, "Lösche Dateien…", done, total, photoDisplayName(entry));
    }
  }

  showProgress(false);

  // Erfolgreich verarbeitete Fotos aus der Liste entfernen (nicht markierte bleiben unverändert).
  // Fehlgeschlagene Dateien bleiben mit zurückgesetzter Aktion in der Liste sichtbar.
  const stillPresent = [];
  const removedEntries = [];
  for (const entry of state.photos) {
    const wasTarget = entry.action === "move" || entry.action === "delete";
    const failed = failedEntries.has(entry);
    if (wasTarget && !failed) { removedEntries.push(entry); continue; } // erfolgreich verarbeitet -> aus Liste entfernen
    if (wasTarget && failed) entry.action = "none"; // Fehlgeschlagen: Aktion zurücksetzen, Datei bleibt sichtbar
    stillPresent.push(entry);
  }
  revokePhotoObjectUrls(removedEntries); // nur die entfernten Fotos, verbleibende Thumbnails bleiben intakt

  state.photos = stillPresent;
  state.selectedIndices.clear();
  state.cursorIndex = state.photos.length > 0 ? 0 : -1;
  state.activeFilter = "all"; // nach abgeschlossenem Durchgang: wieder alle verbleibenden Fotos zeigen
  updateFilterButtonsUI();
  recomputeActionCounts();

  renderGrid();
  updateBottomBar();

  if (errors.length > 0) {
    if (verificationFailureCount > 0) {
      showToast(
        `${verificationFailureCount} Datei(en) wurden zur Sicherheit NICHT aus dem Quellverzeichnis gelöscht, da die Prüfung der Zieldatei fehlgeschlagen ist. Details in der Konsole.`,
        "error",
        9000
      );
    }
    const otherFailures = errors.length - verificationFailureCount;
    if (otherFailures > 0) {
      showToast(`${otherFailures} weitere Datei(en) konnten nicht verarbeitet werden. Details in der Konsole.`, "error", 8000);
    }
  } else {
    showToast(`Fertig: ${moveTargets.length} verschoben, ${deleteTargets.length} gelöscht.`, "success");
  }
}

/**
 * Namen, die in DIESEM Durchgang bereits vergeben wurden. Nötig zusätzlich zur
 * Prüfung auf dem Dateisystem, weil die Datei zu einem gerade reservierten Namen
 * noch nicht geschrieben ist, wenn der Name für das nächste Foto gesucht wird.
 * Wird zu Beginn jedes Durchgangs geleert - das Dateisystem ist die maßgebliche
 * Instanz, ein Altbestand aus einem früheren (womöglich anderen) Zielverzeichnis
 * würde nur unnötige "_1"-Suffixe erzeugen.
 */
const usedTargetNames = new Set();

/** Name der XMP-Sidecar-Datei, die zu einem Zieldateinamen gehört. */
function sidecarNameFor(fileName) {
  const dot = fileName.lastIndexOf(".");
  return (dot === -1 ? fileName : fileName.slice(0, dot)) + ".xmp";
}

/** Prüft, ob im Zielverzeichnis bereits eine Datei dieses Namens liegt. */
async function targetFileExists(targetDirHandle, name) {
  try {
    await targetDirHandle.getFileHandle(name);
    return true;
  } catch (e) {
    if (e.name === "NotFoundError") return false;
    // Anderer Fehler (z.B. fehlende Berechtigung): im Zweifel als "existiert"
    // behandeln und ausweichen, statt eine womöglich vorhandene Datei zu überschreiben.
    return true;
  }
}

/**
 * Ermittelt einen im Zielverzeichnis garantiert freien Dateinamen.
 *
 * Prüft dazu ausdrücklich das DATEISYSTEM und nicht nur die in dieser Sitzung
 * vergebenen Namen: getFileHandle(name, {create:true}) + createWritable() würde
 * eine bestehende Datei sonst kommentarlos überschreiben, und die Sicherheits-
 * prüfung danach würde das nicht bemerken (die neu geschriebene Datei ist ja in
 * sich stimmig) - die Quelldatei würde anschließend gelöscht und der bisherige
 * Inhalt der Zieldatei wäre unwiederbringlich weg.
 *
 * Der Name der zugehörigen XMP-Sidecar-Datei wird mitgeprüft und mitreserviert,
 * damit zwei Fotos mit gleichem Basisnamen aber verschiedener Endung (foto.jpg /
 * foto.png) sich nicht gegenseitig die Sidecar-Datei überschreiben.
 */
async function ensureUniqueName(targetDirHandle, baseName, ext) {
  let candidate = `${baseName}.${ext}`;
  let n = 1;
  while (
    usedTargetNames.has(candidate) ||
    usedTargetNames.has(sidecarNameFor(candidate)) ||
    (await targetFileExists(targetDirHandle, candidate)) ||
    (await targetFileExists(targetDirHandle, sidecarNameFor(candidate)))
  ) {
    candidate = `${baseName}_${n}.${ext}`;
    n++;
    if (n > 9999) {
      throw new Error(`Kein freier Dateiname für „${baseName}.${ext}" im Zielverzeichnis gefunden.`);
    }
  }
  usedTargetNames.add(candidate);
  usedTargetNames.add(sidecarNameFor(candidate));
  return candidate;
}

/* ============================================================
   STICHWORTKATALOG
   ============================================================ */

function generateCatalogId() {
  return "kw_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function getCatalog() {
  return appSettings.keywordCatalog;
}

function persistCatalog() {
  saveSettings(appSettings);
}

/* ---- Stichwort-Pool (global) ---- */

function findKeyword(id) {
  return getCatalog().keywords.find((k) => k.id === id) || null;
}

/** Legt ein neues Stichwort im globalen Pool an und hängt es an den übergebenen Container (Gruppe/Set). */
function createKeywordInContainer(container, label) {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const kw = { id: generateCatalogId(), label: trimmed };
  getCatalog().keywords.push(kw);
  container.keywordIds.push(kw.id);
  persistCatalog();
  return kw;
}

function renameKeyword(id, newLabel) {
  const trimmed = newLabel.trim();
  if (!trimmed) return;
  const kw = findKeyword(id);
  if (kw) {
    kw.label = trimmed;
    persistCatalog();
  }
}

/**
 * Entfernt ein Stichwort komplett aus dem globalen Pool sowie aus JEDER Gruppe,
 * jedem Set und jedem Favoriten-Slot, der darauf verweist (geteilter Pool ->
 * ein gelöschtes Stichwort darf nirgendwo als tote Referenz übrig bleiben).
 */
function deleteKeywordEverywhere(id) {
  const catalog = getCatalog();
  catalog.keywords = catalog.keywords.filter((k) => k.id !== id);
  catalog.groups.forEach((g) => { g.keywordIds = g.keywordIds.filter((kid) => kid !== id); });
  catalog.sets.forEach((s) => { s.keywordIds = s.keywordIds.filter((kid) => kid !== id); });
  catalog.favorites = catalog.favorites.map((f) =>
    f && f.type === "keyword" && f.keywordId === id ? null : f
  );
  persistCatalog();
}

/** Entfernt ein Stichwort NUR aus einem bestimmten Container (Gruppe/Set), bleibt aber im globalen Pool erhalten. */
function removeKeywordFromContainer(container, id) {
  container.keywordIds = container.keywordIds.filter((kid) => kid !== id);
  persistCatalog();
}

/* ---- Gruppen ---- */

function createGroup(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const group = { id: generateCatalogId(), name: trimmed, keywordIds: [] };
  getCatalog().groups.push(group);
  persistCatalog();
  return group;
}

function renameGroup(id, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;
  const group = getCatalog().groups.find((g) => g.id === id);
  if (group) { group.name = trimmed; persistCatalog(); }
}

function deleteGroup(id) {
  const catalog = getCatalog();
  // Stichworte bleiben im globalen Pool erhalten (könnten noch in Sets verwendet werden) -
  // nur die Gruppe selbst und ihre Zuordnung verschwinden.
  catalog.groups = catalog.groups.filter((g) => g.id !== id);
  persistCatalog();
}

/* ---- Sets ---- */

function createSet(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const set = { id: generateCatalogId(), name: trimmed, keywordIds: [] };
  getCatalog().sets.push(set);
  persistCatalog();
  return set;
}

function renameSet(id, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;
  const set = getCatalog().sets.find((s) => s.id === id);
  if (set) { set.name = trimmed; persistCatalog(); }
}

function deleteSet(id) {
  const catalog = getCatalog();
  catalog.sets = catalog.sets.filter((s) => s.id !== id);
  persistCatalog();
}

/* ---- UI-Zustand ---- */

const catalogUi = {
  activeTab: "groups", // 'groups' | 'sets' | 'favorites'
  selectedGroupId: null,
  selectedSetId: null,
  pendingFavoriteSlot: null, // Index des Favoriten-Slots, für den gerade ein Stichwort gewählt wird
};

function openKeywordCatalogDialog() {
  document.getElementById("keywordCatalogOverlay").classList.remove("hidden");
  renderCatalogTab();
}

function closeKeywordCatalogDialog() {
  document.getElementById("keywordCatalogOverlay").classList.add("hidden");
}

document.getElementById("btnKeywordCatalog").addEventListener("click", openKeywordCatalogDialog);
document.getElementById("btnCloseKeywordCatalog").addEventListener("click", closeKeywordCatalogDialog);
document.getElementById("btnCloseKeywordCatalog2").addEventListener("click", closeKeywordCatalogDialog);

document.querySelectorAll(".catalogTab").forEach((tab) => {
  tab.addEventListener("click", () => {
    catalogUi.activeTab = tab.dataset.catalogTab;
    renderCatalogTab();
  });
});

function renderCatalogTab() {
  document.querySelectorAll(".catalogTab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.catalogTab === catalogUi.activeTab);
  });
  document.querySelectorAll(".catalogPane").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.catalogPane === catalogUi.activeTab);
  });

  if (catalogUi.activeTab === "groups") renderGroupList();
  else if (catalogUi.activeTab === "sets") renderSetList();
  else if (catalogUi.activeTab === "favorites") renderFavoritesGrid();
}

/* ---- Rendering: Gruppen-Tab ---- */

function renderGroupList() {
  const listEl = document.getElementById("groupList");
  const groups = getCatalog().groups;
  listEl.innerHTML = "";

  if (groups.length === 0) {
    listEl.innerHTML = `<div class="catalogFootnote" style="padding:10px;">Noch keine Gruppen angelegt.</div>`;
  }

  groups.forEach((group) => {
    const item = document.createElement("div");
    item.className = "catalogListItem" + (group.id === catalogUi.selectedGroupId ? " active" : "");
    item.innerHTML = `
      <span class="itemName">${escapeHtml(group.name)}</span>
      <span class="itemCount">${group.keywordIds.length}</span>
      <span class="itemActions">
        <button class="iconBtn" data-action="rename" title="Umbenennen">✎</button>
        <button class="iconBtn danger" data-action="delete" title="Löschen">🗑</button>
      </span>
    `;
    item.addEventListener("click", (ev) => {
      const actionBtn = ev.target.closest("[data-action]");
      if (actionBtn) {
        ev.stopPropagation();
        if (actionBtn.dataset.action === "rename") {
          const newName = prompt("Neuer Name der Gruppe:", group.name);
          if (newName != null) { renameGroup(group.id, newName); renderGroupList(); renderGroupDetail(); }
        } else if (actionBtn.dataset.action === "delete") {
          if (confirm(`Gruppe „${group.name}“ wirklich löschen? (Die enthaltenen Stichworte bleiben im Katalog erhalten.)`)) {
            deleteGroup(group.id);
            if (catalogUi.selectedGroupId === group.id) catalogUi.selectedGroupId = null;
            renderGroupList();
            renderGroupDetail();
          }
        }
        return;
      }
      catalogUi.selectedGroupId = group.id;
      renderGroupList();
      renderGroupDetail();
    });
    listEl.appendChild(item);
  });

  renderGroupDetail();
}

document.getElementById("btnAddGroup").addEventListener("click", () => {
  const input = document.getElementById("newGroupInput");
  const group = createGroup(input.value);
  if (group) {
    input.value = "";
    catalogUi.selectedGroupId = group.id;
    renderGroupList();
  }
});
document.getElementById("newGroupInput").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") document.getElementById("btnAddGroup").click();
});

function renderGroupDetail() {
  const col = document.getElementById("groupDetailCol");
  const group = getCatalog().groups.find((g) => g.id === catalogUi.selectedGroupId);
  if (!group) {
    col.innerHTML = `<div class="catalogDetailEmpty">Wähle links eine Gruppe aus oder lege eine neue an.</div>`;
    return;
  }
  renderContainerDetail(col, group, () => renderGroupList(), renameGroup);
}

/* ---- Rendering: Sets-Tab ---- */

function renderSetList() {
  const listEl = document.getElementById("setList");
  const sets = getCatalog().sets;
  listEl.innerHTML = "";

  if (sets.length === 0) {
    listEl.innerHTML = `<div class="catalogFootnote" style="padding:10px;">Noch keine Sets angelegt.</div>`;
  }

  sets.forEach((set) => {
    const item = document.createElement("div");
    item.className = "catalogListItem" + (set.id === catalogUi.selectedSetId ? " active" : "");
    item.innerHTML = `
      <span class="itemName">${escapeHtml(set.name)}</span>
      <span class="itemCount">${set.keywordIds.length}</span>
      <span class="itemActions">
        <button class="iconBtn" data-action="rename" title="Umbenennen">✎</button>
        <button class="iconBtn danger" data-action="delete" title="Löschen">🗑</button>
      </span>
    `;
    item.addEventListener("click", (ev) => {
      const actionBtn = ev.target.closest("[data-action]");
      if (actionBtn) {
        ev.stopPropagation();
        if (actionBtn.dataset.action === "rename") {
          const newName = prompt("Neuer Name des Sets:", set.name);
          if (newName != null) { renameSet(set.id, newName); renderSetList(); renderSetDetail(); }
        } else if (actionBtn.dataset.action === "delete") {
          if (confirm(`Set „${set.name}“ wirklich löschen? (Die enthaltenen Stichworte bleiben im Katalog erhalten.)`)) {
            deleteSet(set.id);
            if (catalogUi.selectedSetId === set.id) catalogUi.selectedSetId = null;
            renderSetList();
            renderSetDetail();
          }
        }
        return;
      }
      catalogUi.selectedSetId = set.id;
      renderSetList();
      renderSetDetail();
    });
    listEl.appendChild(item);
  });

  renderSetDetail();
}

document.getElementById("btnAddSet").addEventListener("click", () => {
  const input = document.getElementById("newSetInput");
  const set = createSet(input.value);
  if (set) {
    input.value = "";
    catalogUi.selectedSetId = set.id;
    renderSetList();
  }
});
document.getElementById("newSetInput").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") document.getElementById("btnAddSet").click();
});

function renderSetDetail() {
  const col = document.getElementById("setDetailCol");
  const set = getCatalog().sets.find((s) => s.id === catalogUi.selectedSetId);
  if (!set) {
    col.innerHTML = `<div class="catalogDetailEmpty">Wähle links ein Set aus oder lege eines neu an.</div>`;
    return;
  }
  renderContainerDetail(col, set, () => renderSetList(), renameSet);
}

/**
 * Gemeinsames Detail-Rendering für Gruppen und Sets: Name bearbeiten, Stichworte
 * hinzufügen/umbenennen/entfernen. `container` ist eine Gruppe oder ein Set
 * (beide haben dieselbe Form { id, name, keywordIds }). `renameFn` ist die
 * passende rename-Funktion (renameGroup oder renameSet) für diesen Container-Typ.
 */
function renderContainerDetail(col, container, onNameChanged, renameFn) {
  col.innerHTML = `
    <div class="catalogDetailHeader">
      <input type="text" id="containerNameInput" value="${escapeHtml(container.name)}">
    </div>
    <div class="catalogKeywordAdd">
      <input type="text" id="containerKeywordInput" placeholder="Neues Stichwort hinzufügen…">
      <button id="containerAddKeywordBtn" class="primary">+ Hinzufügen</button>
    </div>
    <div class="catalogKeywordList" id="containerKeywordList"></div>
    <div class="catalogFootnote">Stichworte gehören zum gemeinsamen Katalog-Pool und können in mehreren Gruppen/Sets vorkommen. Entfernen hier löscht das Stichwort nur aus diesem Bereich, nicht aus dem Katalog.</div>
  `;

  const nameInput = col.querySelector("#containerNameInput");
  nameInput.addEventListener("change", () => {
    renameFn(container.id, nameInput.value);
    onNameChanged();
  });

  const addBtn = col.querySelector("#containerAddKeywordBtn");
  const addInput = col.querySelector("#containerKeywordInput");
  const doAdd = () => {
    if (createKeywordInContainer(container, addInput.value)) {
      addInput.value = "";
      renderKeywordChips();
      onNameChanged(); // Anzahl-Badge in der Liste links aktualisieren
    }
  };
  addBtn.addEventListener("click", doAdd);
  addInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") doAdd(); });

  function renderKeywordChips() {
    const listEl = col.querySelector("#containerKeywordList");
    listEl.innerHTML = "";
    if (container.keywordIds.length === 0) {
      listEl.innerHTML = `<div class="catalogFootnote">Noch keine Stichworte in diesem Bereich.</div>`;
    }
    container.keywordIds.forEach((kid) => {
      const kw = findKeyword(kid);
      if (!kw) return; // tote Referenz (sollte durch deleteKeywordEverywhere eigentlich nicht vorkommen)
      const chip = document.createElement("div");
      chip.className = "keywordChip";
      chip.innerHTML = `
        <input type="text" value="${escapeHtml(kw.label)}" data-kwid="${kw.id}" size="${Math.max(3, kw.label.length)}">
        <button class="iconBtn" data-action="removeFromContainer" title="Aus diesem Bereich entfernen">✕</button>
        <button class="iconBtn danger" data-action="deleteEverywhere" title="Stichwort komplett aus dem Katalog löschen">🗑</button>
      `;
      const input = chip.querySelector("input");
      input.addEventListener("change", () => renameKeyword(kw.id, input.value));
      chip.querySelector('[data-action="removeFromContainer"]').addEventListener("click", () => {
        removeKeywordFromContainer(container, kw.id);
        renderKeywordChips();
        onNameChanged();
      });
      chip.querySelector('[data-action="deleteEverywhere"]').addEventListener("click", () => {
        if (confirm(`Stichwort „${kw.label}“ wirklich komplett aus dem Katalog löschen? Es wird aus allen Gruppen, Sets und Favoriten entfernt.`)) {
          deleteKeywordEverywhere(kw.id);
          renderKeywordChips();
          onNameChanged();
        }
      });
      listEl.appendChild(chip);
    });
  }
  renderKeywordChips();
}

/* ---- Rendering: Favoriten-Tab ---- */

function renderFavoritesGrid() {
  const grid = document.getElementById("favoritesGrid");
  grid.innerHTML = "";
  const favorites = getCatalog().favorites;

  favorites.forEach((fav, index) => {
    const slot = document.createElement("div");
    slot.className = "favoriteSlot" + (fav ? "" : " empty");

    const label = fav ? favoriteLabel(fav) : "Nicht belegt";
    slot.innerHTML = `
      <div class="slotNumber">FAVORIT ${index + 1}</div>
      <div class="slotLabel">${escapeHtml(label)}</div>
      <div class="slotActions"></div>
    `;
    const actionsEl = slot.querySelector(".slotActions");

    const pickBtn = document.createElement("button");
    pickBtn.textContent = "Aus Katalog…";
    pickBtn.addEventListener("click", () => openKeywordPicker(index));
    actionsEl.appendChild(pickBtn);

    const freeBtn = document.createElement("button");
    freeBtn.textContent = "Frei eingeben…";
    freeBtn.addEventListener("click", () => {
      const text = prompt("Freien Text für diesen Favoriten eingeben:", fav && fav.type === "free" ? fav.label : "");
      if (text != null && text.trim()) {
        getCatalog().favorites[index] = { type: "free", label: text.trim() };
        persistCatalog();
        renderFavoritesGrid();
      }
    });
    actionsEl.appendChild(freeBtn);

    if (fav) {
      const clearBtn = document.createElement("button");
      clearBtn.textContent = "Leeren";
      clearBtn.addEventListener("click", () => {
        getCatalog().favorites[index] = null;
        persistCatalog();
        renderFavoritesGrid();
      });
      actionsEl.appendChild(clearBtn);
    }

    grid.appendChild(slot);
  });
}

function favoriteLabel(fav) {
  if (!fav) return "";
  if (fav.type === "free") return fav.label;
  if (fav.type === "keyword") {
    const kw = findKeyword(fav.keywordId);
    return kw ? kw.label : "(gelöschtes Stichwort)";
  }
  return "";
}

/* ---- Stichwort-Auswahl-Dialog (für Favoriten "Aus Katalog…") ---- */

function openKeywordPicker(slotIndex) {
  catalogUi.pendingFavoriteSlot = slotIndex;
  document.getElementById("keywordPickerSearch").value = "";
  renderKeywordPickerList("");
  document.getElementById("keywordPickerOverlay").classList.remove("hidden");
  document.getElementById("keywordPickerSearch").focus();
}

function closeKeywordPicker() {
  document.getElementById("keywordPickerOverlay").classList.add("hidden");
  catalogUi.pendingFavoriteSlot = null;
}

document.getElementById("btnKeywordPickerCancel").addEventListener("click", closeKeywordPicker);
document.getElementById("keywordPickerSearch").addEventListener("input", (ev) => {
  renderKeywordPickerList(ev.target.value);
});

/**
 * Zeigt alle Katalog-Stichworte gruppiert nach Fundort (Gruppen zuerst, dann Sets)
 * zur Auswahl an. Ein Stichwort, das in mehreren Containern vorkommt, wird nur
 * einmal aufgeführt (Auswahl bezieht sich auf das Stichwort selbst, nicht den Container).
 */
function renderKeywordPickerList(filterText) {
  const listEl = document.getElementById("keywordPickerList");
  listEl.innerHTML = "";
  const catalog = getCatalog();
  const needle = filterText.trim().toLowerCase();

  const matching = catalog.keywords.filter((k) => !needle || k.label.toLowerCase().includes(needle));

  if (matching.length === 0) {
    listEl.innerHTML = `<div class="catalogFootnote" style="padding:10px;">Keine Stichworte gefunden.</div>`;
    return;
  }

  matching
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, "de"))
    .forEach((kw) => {
      const item = document.createElement("div");
      item.className = "keywordPickerItem";
      item.textContent = kw.label;
      item.addEventListener("click", () => {
        if (catalogUi.pendingFavoriteSlot != null) {
          getCatalog().favorites[catalogUi.pendingFavoriteSlot] = { type: "keyword", keywordId: kw.id };
          persistCatalog();
          renderFavoritesGrid();
        }
        closeKeywordPicker();
      });
      listEl.appendChild(item);
    });
}

/* ---- Export / Import: nur der Stichwortkatalog (unabhängig von den übrigen Einstellungen) ---- */

document.getElementById("btnExportCatalog").addEventListener("click", () => {
  const dataStr = JSON.stringify(getCatalog(), null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "foto-importer-stichwortkatalog.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Stichwortkatalog exportiert.", "success");
});

document.getElementById("btnImportCatalog").addEventListener("click", () => {
  document.getElementById("importCatalogFile").click();
});

document.getElementById("importCatalogFile").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Ungültiges Format der Katalogdatei.");
    }
    normalizeKeywordCatalog(parsed);
    appSettings.keywordCatalog = parsed;
    persistCatalog();
    catalogUi.selectedGroupId = null;
    catalogUi.selectedSetId = null;
    renderCatalogTab();
    showToast("Stichwortkatalog erfolgreich importiert.", "success");
  } catch (e) {
    console.error(e);
    showToast("Import fehlgeschlagen: " + e.message, "error");
  } finally {
    ev.target.value = "";
  }
});

/* ============================================================
   PROGRESS OVERLAY
   ============================================================ */

function showProgress(visible, title, done, total, detailName) {
  const overlay = document.getElementById("progressOverlay");
  if (!visible) {
    overlay.classList.add("hidden");
    return;
  }
  overlay.classList.remove("hidden");
  document.getElementById("progressTitle").textContent = title || "Verarbeite…";
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById("progressBarFill").style.width = pct + "%";
  document.getElementById("progressDetail").textContent =
    `${done} / ${total}` + (detailName ? ` — ${detailName}` : "");
}

/* ============================================================
   HILFE (F1)
   ============================================================
   Inhalte inhaltlich deckungsgleich mit HANDBUCH.md, hier als durchsuchbares
   In-App-Overlay mit Kapitelnavigation aufbereitet.
   ============================================================ */

/* ============================================================
   DAUERHAFTE SHORTCUT-LEISTEN (Grid und Leuchttisch getrennt)
   ============================================================
   Nach Funktion gruppiert, ein-/ausblendbar per Symbol-Button. Dieselbe
   Aktion nutzt in beiden Ansichten bewusst immer dieselbe Taste - nur
   Funktionen, die es exklusiv in einer Ansicht gibt (Quick Look im Grid,
   die Lupe im Leuchttisch), stehen auch nur dort.
   ============================================================ */

const GRID_SHORTCUT_GROUPS = [
  {
    label: "Navigation",
    entries: [
      { keys: "↑ ↓ ← →", label: "Navigieren" },
      { keys: "Shift+Pfeil", label: "Bereich erweitern" },
      { keys: "Strg+A", label: "Alle wählen" },
    ],
  },
  {
    label: "Aktionen",
    entries: [
      { keys: "V", label: "Verschieben" },
      { keys: "L", label: "Löschen" },
      { keys: "X", label: "Aufheben" },
    ],
  },
  {
    label: "Stichworte",
    entries: [
      { keys: "1–9", label: "Favorit" },
      { keys: "T", label: "Zuweisungspanel" },
    ],
  },
  {
    label: "Ansicht",
    entries: [
      { keys: "I", label: "Bildinfo" },
      { keys: "Leertaste", label: "Ganzes Foto" },
      { keys: "Enter", label: "Leuchttisch" },
      { keys: "Esc", label: "Overlay schließen" },
    ],
  },
];

const LIGHTBOX_SHORTCUT_GROUPS = [
  {
    label: "Navigation",
    entries: [
      { keys: "← →", label: "Blättern" },
    ],
  },
  {
    label: "Aktionen",
    entries: [
      { keys: "V", label: "Verschieben" },
      { keys: "L", label: "Löschen" },
      { keys: "X", label: "Aufheben" },
    ],
  },
  {
    label: "Stichworte",
    entries: [
      { keys: "1–9", label: "Favorit" },
      { keys: "T", label: "Panel ein/aus" },
    ],
  },
  {
    label: "Ansicht",
    entries: [
      { keys: "I", label: "Bildinfo" },
      { keys: "M", label: "Lupe" },
      { keys: "Esc", label: "Schließen" },
    ],
  },
];

function renderShortcutBar(containerId, groups) {
  const el = document.getElementById(containerId);
  el.innerHTML = groups
    .map((group) => {
      const entriesHtml = group.entries
        .map((e) => `<span class="shortcutEntry"><kbd>${escapeHtml(e.keys)}</kbd>${escapeHtml(e.label)}</span>`)
        .join("");
      return `<div class="shortcutGroup"><span class="shortcutGroupLabel">${escapeHtml(group.label)}</span>${entriesHtml}</div>`;
    })
    .join("");
}

function toggleGridShortcutBar() {
  const bar = document.getElementById("gridShortcutBar");
  const btn = document.getElementById("btnToggleGridShortcuts");
  const nowVisible = bar.classList.toggle("hidden") === false;
  btn.classList.toggle("active", nowVisible);
  if (nowVisible) renderShortcutBar("gridShortcutBar", GRID_SHORTCUT_GROUPS);
}

function toggleLightboxShortcutBar() {
  const bar = document.getElementById("lightboxShortcutBar");
  const btn = document.getElementById("btnToggleLbShortcuts");
  const nowVisible = bar.classList.toggle("hidden") === false;
  btn.classList.toggle("active", nowVisible);
  if (nowVisible) renderShortcutBar("lightboxShortcutBar", LIGHTBOX_SHORTCUT_GROUPS);
}

document.getElementById("btnToggleGridShortcuts").addEventListener("click", toggleGridShortcutBar);
document.getElementById("btnToggleLbShortcuts").addEventListener("click", toggleLightboxShortcutBar);
document.getElementById("btnOpenHelp").addEventListener("click", openHelp);

const HELP_CHAPTERS = [
  {
    id: "erste-schritte",
    title: "Erste Schritte",
    html: `
      <h3>Erste Schritte</h3>
      <p>Foto-Importer benötigt einen Chromium-basierten Browser (<b>Chrome</b> oder <b>Edge</b>, Desktop) wegen der File System Access API. Es ist keine Installation nötig.</p>
      <ul>
        <li><b>Quellverzeichnis öffnen</b>: Button „📂 Quellverzeichnis öffnen“ in der Toolbar.</li>
        <li><b>Zielverzeichnis wählen</b>: Button „🎯 Zielverzeichnis wählen“ – wird erst beim Verschieben benötigt.</li>
      </ul>
      <p>Es werden nur Dateien direkt im gewählten Ordner gelesen, keine Unterordner. Der Programmzustand bleibt nach einem Neuladen der Seite nicht erhalten (außer Stichwortkatalog und Namensschema-Voreinstellungen) – der Ordner muss dann erneut geöffnet werden.</p>
    `,
  },
  {
    id: "gridansicht",
    title: "Die Gridansicht",
    html: `
      <h3>Die Gridansicht</h3>
      <p>Jede Kachel zeigt eine Vorschau, den Dateinamen sowie Hinweise auf zugewiesene Aktion (farbiger Rahmen), zugewiesene Stichworte (Chips + 🏷-Symbol), aktuellen Cursor (gelber Rahmen) und Mehrfachauswahl (blaue Hervorhebung).</p>
      <p>Navigation mit den Pfeiltasten. <kbd>Shift</kbd>+Pfeiltaste erweitert die Auswahl. Mit der Maus: Klick wählt aus, <kbd>Strg</kbd>/<kbd>Cmd</kbd>+Klick fügt hinzu, <kbd>Shift</kbd>+Klick wählt einen Bereich.</p>
    `,
  },
  {
    id: "aktionen",
    title: "Aktionen: Verschieben und Löschen",
    html: `
      <h3>Aktionen: Verschieben und Löschen</h3>
      <p>Jedem Foto kann eine Aktion zugewiesen werden:</p>
      <ul>
        <li><kbd>V</kbd> – zum <b>Verschieben</b> ins Zielverzeichnis vormerken</li>
        <li><kbd>L</kbd> – zum <b>Löschen</b> aus dem Quellverzeichnis vormerken</li>
        <li><kbd>X</kbd> – Aktion wieder <b>aufheben</b></li>
      </ul>
      <p>Diese Tasten wirken auf das angesteuerte Foto oder, bei aktiver Mehrfachauswahl, auf alle ausgewählten Fotos.</p>
      <p>Der Button „Aktionen ausführen ▶“ führt alle gesetzten Aktionen aus. Bei mindestens einem zum Verschieben markierten Foto fragt das Programm zuvor nach einer Ereignisbeschreibung.</p>
      <p>Bei mindestens einem zum Löschen markierten Foto erscheint zusätzlich eine Sicherheitsabfrage mit der Anzahl der betroffenen Fotos. Gelöschte Dateien landen <b>nicht im Papierkorb</b> und lassen sich nicht wiederherstellen.</p>
      <p>Die Kürzel wirken nur als einzelne Tasten. <kbd>Strg</kbd>/<kbd>Cmd</kbd> in Kombination (z. B. <kbd>Strg</kbd>+<kbd>V</kbd> zum Einfügen) bleibt dem Browser überlassen – einzige Ausnahme ist <kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>A</kbd> für „alles auswählen“.</p>
    `,
  },
  {
    id: "sortierung-filter",
    title: "Sortierung und Filterung",
    html: `
      <h3>Sortierung und Filterung</h3>
      <p><b>Sortierung:</b> Dropdown mit vier Kriterien – Dateiname (natürliche Sortierung), Dateidatum, Aufnahmedatum, Dateigröße. Der Button daneben kehrt die Richtung um. Der Cursor bleibt beim Umsortieren auf demselben Foto.</p>
      <p><b>Filterung:</b> sechs Filter, jeweils nur einer aktiv – Alle, zum Verschieben, zum Löschen, Unmarkiert, Mit Stichworten, Ohne Stichworte.</p>
      <p>Der Leuchttisch folgt beim Blättern derselben Sortierung und Filterung wie das Grid.</p>
    `,
  },
  {
    id: "katalog",
    title: "Der Stichwortkatalog",
    html: `
      <h3>Der Stichwortkatalog</h3>
      <p>Über „🏷️ Stichwortkatalog…“ erreichbar. Drei Bereiche: <b>Gruppen</b> (thematisch, z. B. „Landschaft“), <b>Sets</b> (ereignisbezogen, z. B. „Hochzeit“), <b>Favoriten</b> (neun Slots für Zifferntasten-Zugriff).</p>
      <p>Stichworte gehören zu einem gemeinsamen Pool: dasselbe Stichwort kann in mehreren Gruppen/Sets vorkommen. Umbenennen wirkt überall, Entfernen aus einem Bereich lässt es in anderen Bereichen unangetastet. Nur die komplette Löschung entfernt es überall, auch aus Favoriten.</p>
      <p>Export/Import des Katalogs als eigene <code>.json</code>-Datei über die Buttons im Dialog-Footer.</p>
    `,
  },
  {
    id: "stichworte-zuweisen",
    title: "Stichworte zuweisen",
    html: `
      <h3>Stichworte zuweisen</h3>
      <p>Im Grid: <kbd>T</kbd> öffnet das Zuweisungspanel mit Favoriten, Gruppen/Sets (als Toggle-Chips) und einer durchsuchbaren Stichwortliste. Zusätzlich weisen die Zifferntasten <kbd>1</kbd>–<kbd>9</kbd> die neun Favoriten direkt zu bzw. entfernen sie wieder (Toggle).</p>
      <p>Bei Mehrfachauswahl mit gemischtem Zustand wird beim Toggle immer <b>ergänzt</b>, nie entfernt – nur wenn wirklich alle ausgewählten Fotos ein Stichwort bereits tragen, entfernt ein erneuter Toggle es bei allen.</p>
      <p>Im Leuchttisch steht dieselbe Funktion über das Seitenpanel zur Verfügung.</p>
    `,
  },
  {
    id: "leuchttisch",
    title: "Der Leuchttisch",
    html: `
      <h3>Der Leuchttisch</h3>
      <p><kbd>Enter</kbd> öffnet den Leuchttisch für das angesteuerte Foto. Er zeigt das Foto groß, mit einem Filmstreifen benachbarter Fotos unten sowie einem ein-/ausblendbaren Seitenpanel (<kbd>T</kbd>) für Stichworte und Aktionen.</p>
      <p>Zugewiesene Stichworte und Aktionen sind zwischen Grid und Leuchttisch in Echtzeit synchron.</p>
      <p><kbd>←</kbd>/<kbd>→</kbd> blättert innerhalb der aktuellen Sortierung/Filterung. <kbd>Escape</kbd> schließt zunächst offene Overlays, dann den Leuchttisch.</p>
    `,
  },
  {
    id: "exif",
    title: "Bildinformationen (EXIF)",
    html: `
      <h3>Bildinformationen (EXIF)</h3>
      <p><kbd>I</kbd> blendet ein Info-Panel mit Kamera, Belichtungsdaten, Blitz, Weißabgleich, GPS-Koordinaten, Aufnahmedatum, Bildabmessungen und Dateigröße ein.</p>
      <p>Im Leuchttisch erscheint es dezent oben rechts und aktualisiert sich beim Blättern automatisch. Im Grid ist es nur bei genau einem ausgewählten Foto verfügbar.</p>
    `,
  },
  {
    id: "quicklook",
    title: "Ganzes Foto anzeigen (Quick Look)",
    html: `
      <h3>Ganzes Foto anzeigen (Quick Look)</h3>
      <p>Im Grid öffnet die <kbd>Leertaste</kbd> bei genau einem angesteuerten Foto eine schnelle, bildschirmfüllende Vorschau ohne Bedienelemente. <kbd>Escape</kbd> oder Klick auf den Hintergrund schließt sie.</p>
      <p>Bei aktiver Mehrfachauswahl schaltet die Leertaste stattdessen das angesteuerte Foto in der Auswahl an/aus.</p>
    `,
  },
  {
    id: "lupe",
    title: "Die Lupe",
    html: `
      <h3>Die Lupe</h3>
      <p>Nur im Leuchttisch: <kbd>M</kbd> blendet eine runde Lupe ein, die dem Mauszeiger folgt und einen 2,5-fach vergrößerten Bildausschnitt zeigt, basierend auf einer möglichst hochauflösenden Version des Fotos. <kbd>Escape</kbd> schließt zuerst die Lupe, bevor ein zweites <kbd>Escape</kbd> den Leuchttisch verlässt.</p>
    `,
  },
  {
    id: "namensschema",
    title: "Namensschema beim Verschieben",
    html: `
      <h3>Namensschema beim Verschieben</h3>
      <p>Über „⚙️ Namensschema…“ lässt sich der Ziel-Dateiname aus Bausteinen (Datum, Ereignis, Zähler, Freitext, Trenner) per Drag &amp; Drop zusammensetzen. Schemata lassen sich als Voreinstellung speichern.</p>
      <p>Beim Verschieben fragt das Programm nach einer Ereignisbeschreibung, die sowohl in den Dateinamen einfließt (Leerzeichen → Unterstriche, in Dateinamen unzulässige Zeichen wie <code>/ \\ : * ? " &lt; &gt; |</code> → Bindestriche) als auch unverändert als Beschreibung in die Metadaten geschrieben wird. Die Vorschau im Ereignis-Dialog zeigt das Ergebnis dieser Umwandlung.</p>
    `,
  },
  {
    id: "metadaten",
    title: "Metadaten in den Dateien (IPTC/XMP)",
    html: `
      <h3>Metadaten in den Dateien (IPTC/XMP)</h3>
      <p>Beim Verschieben werden Stichworte und Beschreibung standardkonform in die Dateien geschrieben:</p>
      <ul>
        <li><b>JPEG:</b> Stichworte als IPTC-IIM-Keywords und XMP <code>dc:subject</code>, Beschreibung als IPTC Caption/Abstract und XMP <code>dc:description</code> – direkt in die Datei eingebettet, ohne andere Metadaten oder die Bilddaten zu verändern.</li>
        <li><b>Alle Formate:</b> zusätzlich eine XMP-Sidecar-Datei (<code>dateiname.xmp</code>) neben dem Foto.</li>
      </ul>
      <p>Schlägt das direkte Schreiben fehl, greift automatisch der sichere Rückfall auf die unveränderte Originaldatei plus Sidecar.</p>
    `,
  },
  {
    id: "sicherheit",
    title: "Sicherheit beim Verschieben",
    html: `
      <h3>Sicherheit beim Verschieben</h3>
      <p>Es wird <b>nie eine vorhandene Datei im Zielverzeichnis überschrieben</b>: Ist der geplante Name dort (oder als zugehörige <code>.xmp</code>-Datei) schon vergeben, weicht das Programm auf <code>name_1</code>, <code>name_2</code> usw. aus – auch über mehrere Durchgänge und Programmstarts hinweg.</p>
      <p>Vor dem Löschen der Quelldatei prüft das Programm die neu geschriebene Zieldatei aktiv: Größe, Prüfsumme der Bilddaten (SHA-256, bei JPEG nur der garantiert unveränderte Bildanteil), die eingebetteten Metadaten sowie – falls geschrieben – den Inhalt der XMP-Sidecar-Datei.</p>
      <p>Schlägt eine Prüfung fehl, wird die Quelldatei <b>nicht gelöscht</b>, das Foto bleibt im Grid sichtbar, und eine Meldung weist auf die betroffene Datei hin.</p>
    `,
  },
  {
    id: "einstellungen",
    title: "Programmeinstellungen: Export/Import",
    html: `
      <h3>Programmeinstellungen: Export/Import</h3>
      <p>Über „🛠️ Einstellungen…“ lassen sich alle Programmeinstellungen (Namensschema-Voreinstellungen, Stichwortkatalog) als Sicherung exportieren und wieder importieren.</p>
    `,
  },
  {
    id: "shortcuts",
    title: "Alle Tastenkürzel",
    html: `
      <h3>Alle Tastenkürzel im Überblick</h3>
      <h4>Gridansicht</h4>
      <table>
        <tr><th>Taste</th><th>Wirkung</th></tr>
        <tr><td><kbd>↑ ↓ ← →</kbd></td><td>Zwischen Fotos navigieren</td></tr>
        <tr><td><kbd>Shift</kbd>+Pfeiltaste</td><td>Auswahlbereich erweitern</td></tr>
        <tr><td><kbd>V</kbd></td><td>Zum Verschieben vormerken</td></tr>
        <tr><td><kbd>L</kbd></td><td>Zum Löschen vormerken</td></tr>
        <tr><td><kbd>X</kbd></td><td>Aktion aufheben</td></tr>
        <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Favorit-Stichwort zuweisen/entfernen</td></tr>
        <tr><td><kbd>T</kbd></td><td>Stichwort-Zuweisungspanel öffnen</td></tr>
        <tr><td><kbd>I</kbd></td><td>Bildinformationen (nur bei Einzelauswahl)</td></tr>
        <tr><td><kbd>Leertaste</kbd></td><td>Ganzes Foto anzeigen (Einzelauswahl) / Auswahl umschalten (Mehrfachauswahl)</td></tr>
        <tr><td><kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>A</kbd></td><td>Alle sichtbaren Fotos auswählen</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Leuchttisch öffnen</td></tr>
        <tr><td><kbd>Escape</kbd></td><td>Offenes Overlay schließen</td></tr>
      </table>
      <h4>Leuchttisch</h4>
      <table>
        <tr><th>Taste</th><th>Wirkung</th></tr>
        <tr><td><kbd>← →</kbd></td><td>Zum vorherigen/nächsten Foto blättern</td></tr>
        <tr><td><kbd>V</kbd></td><td>Verschieben vormerken</td></tr>
        <tr><td><kbd>L</kbd></td><td>Löschen vormerken</td></tr>
        <tr><td><kbd>X</kbd></td><td>Aktion aufheben</td></tr>
        <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Favorit-Stichwort zuweisen/entfernen</td></tr>
        <tr><td><kbd>T</kbd></td><td>Seitenpanel ein-/ausblenden</td></tr>
        <tr><td><kbd>I</kbd></td><td>Bildinformationen ein-/ausblenden</td></tr>
        <tr><td><kbd>M</kbd></td><td>Lupe ein-/ausblenden</td></tr>
        <tr><td><kbd>Escape</kbd></td><td>Schließt zuerst Lupe, dann Bildinformationen, zuletzt den Leuchttisch</td></tr>
      </table>
      <p>Dieselbe Aktion hat in beiden Ansichten immer dieselbe Taste. Nur Funktionen, die es ausschließlich in einer Ansicht gibt (Quick Look im Grid, die Lupe im Leuchttisch), haben eine dort eigene Taste.</p>
    `,
  },
];

let currentHelpChapterId = HELP_CHAPTERS[0].id;

function openHelp() {
  document.getElementById("helpOverlay").classList.remove("hidden");
  document.getElementById("helpSearchInput").value = "";
  renderHelpChapterList();
  renderHelpChapterContent(currentHelpChapterId);
  document.getElementById("helpSearchInput").focus();
}

function closeHelp() {
  document.getElementById("helpOverlay").classList.add("hidden");
}

function renderHelpChapterList() {
  const listEl = document.getElementById("helpChapterList");
  listEl.innerHTML = "";
  HELP_CHAPTERS.forEach((chapter) => {
    const item = document.createElement("div");
    item.className = "helpChapterItem" + (chapter.id === currentHelpChapterId ? " active" : "");
    item.textContent = chapter.title;
    item.addEventListener("click", () => {
      currentHelpChapterId = chapter.id;
      document.getElementById("helpSearchInput").value = "";
      renderHelpChapterList();
      renderHelpChapterContent(chapter.id);
    });
    listEl.appendChild(item);
  });
}

function renderHelpChapterContent(chapterId) {
  const chapter = HELP_CHAPTERS.find((c) => c.id === chapterId) || HELP_CHAPTERS[0];
  document.getElementById("helpContent").innerHTML = chapter.html;
}

document.getElementById("helpSearchInput").addEventListener("input", (ev) => {
  const query = ev.target.value.trim().toLowerCase();
  if (!query) {
    renderHelpChapterList();
    renderHelpChapterContent(currentHelpChapterId);
    return;
  }
  renderHelpSearchResults(query);
});

/** Durchsucht alle Kapitel nach dem Suchbegriff (im reinen Textinhalt, ohne HTML-Tags) und zeigt Treffer mit Hervorhebung. */
function renderHelpSearchResults(query) {
  const listEl = document.getElementById("helpChapterList");
  const contentEl = document.getElementById("helpContent");

  const matches = HELP_CHAPTERS.filter((c) => {
    const plainText = c.html.replace(/<[^>]+>/g, " ").toLowerCase();
    return plainText.includes(query) || c.title.toLowerCase().includes(query);
  });

  listEl.innerHTML = "";
  if (matches.length === 0) {
    listEl.innerHTML = `<div class="helpSearchEmpty">Keine Treffer.</div>`;
    contentEl.innerHTML = `<div class="helpSearchEmpty">Keine Treffer für „${escapeHtml(query)}“.</div>`;
    return;
  }

  matches.forEach((chapter) => {
    const item = document.createElement("div");
    item.className = "helpChapterItem" + (chapter.id === currentHelpChapterId ? " active" : "");
    item.textContent = chapter.title;
    item.addEventListener("click", () => {
      currentHelpChapterId = chapter.id;
      renderHelpSearchResults(query); // Markierung im Listenbereich beibehalten
      showHighlightedChapter(chapter, query);
    });
    listEl.appendChild(item);
  });

  showHighlightedChapter(matches[0], query);
  if (!matches.some((c) => c.id === currentHelpChapterId)) {
    currentHelpChapterId = matches[0].id;
  }
}

function showHighlightedChapter(chapter, query) {
  const contentEl = document.getElementById("helpContent");
  // Hervorhebung nur im Text außerhalb von Tags anwenden, um die HTML-Struktur nicht zu zerstören.
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const highlighted = chapter.html.replace(/>([^<]+)</g, (match, textPart) => {
    return ">" + textPart.replace(regex, "<mark>$1</mark>") + "<";
  });
  contentEl.innerHTML = highlighted;
}

document.getElementById("btnCloseHelp").addEventListener("click", closeHelp);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "F1") {
    ev.preventDefault();
    const helpOpen = !document.getElementById("helpOverlay").classList.contains("hidden");
    if (helpOpen) closeHelp();
    else openHelp();
    return;
  }
  if (ev.key === "Escape" && !document.getElementById("helpOverlay").classList.contains("hidden")) {
    // Capture-Phase + stopPropagation: verhindert, dass ein zusätzlich offener
    // Leuchtkasten oder Quick Look auf dasselbe Escape-Event reagiert und sich
    // "durch die Hilfe hindurch" mitschließt.
    ev.preventDefault();
    ev.stopPropagation();
    closeHelp();
  }
}, true);

/* ============================================================
   INITIALISIERUNG
   ============================================================ */

window.addEventListener("DOMContentLoaded", () => {
  checkFileSystemAccessSupport();
  updateSortControlsUI();
  gridWrap.focus();
});
