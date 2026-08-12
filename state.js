"use strict";

/* ============================================================
   KONSTANTEN & STATE
   ============================================================ */

const PHOTO_EXTENSIONS = new Set([
  "jpg","jpeg","png","heic","heif","gif","bmp","webp",
  "cr2","nef","arw","dng","raf","orf","rw2","srw" // RAW-Formate
]);
const THUMBNAILABLE_EXTENSIONS = new Set(["jpg","jpeg","png","gif","bmp","webp","heic","heif"]);
/**
 * Formate, die der Browser nicht selbst decodieren kann, die aber ein fertiges
 * JPEG als Vorschau mitbringen (siehe raw-preview.js). Für sie wird dieses
 * eingebettete Bild herausgeschnitten und angezeigt.
 */
const RAW_EXTENSIONS = new Set(["cr2","nef","arw","dng","raf","orf","rw2","srw"]);

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

/** Gültige Gliederungen des Zielverzeichnisses (siehe SUBFOLDER_MODES). */
const VALID_SUBFOLDER_MODES = new Set([
  "none", "year", "yearMonth", "yearMonthDay", "event", "yearEvent",
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
      // Unbekannter Modus (ältere oder manipulierte Datei) -> keine Unterordner.
      // Ein nicht erkannter Wert würde sonst still zu "kein Unterordner" führen,
      // aber erst beim Ausführen - hier ist die Stelle, an der das entschieden wird.
      subfolderMode: VALID_SUBFOLDER_MODES.has(preset.subfolderMode) ? preset.subfolderMode : "none",
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
/** Gliederung des Zielverzeichnisses in Unterordner, siehe SUBFOLDER_MODES. */
let currentSubfolderMode = "none";

/**
 * Uebernimmt eine gespeicherte Voreinstellung in das aktuelle Namensschema.
 *
 * Steht hier und nicht beim Namensschema-Dialog, obwohl sie inhaltlich dorthin
 * gehoert: applyDefaultFormatIfNone() ruft sie beim Laden auf, und Top-Level-Code
 * sieht nur, was zu diesem Zeitpunkt bereits geladen ist. Waere sie in naming.js,
 * scheiterte der Start - aber nur bei Nutzern, die tatsaechlich eine
 * Voreinstellung gespeichert haben. Genau die Sorte Fehler, die spaet auffaellt.
 */
function loadPresetIntoBuilder(name) {
  const preset = appSettings.presets[name];
  if (!preset) return;
  currentFormatTokens = JSON.parse(JSON.stringify(preset.tokens));
  currentCounterStart = preset.counterStart;
  currentCounterDigits = preset.counterDigits;
  currentFreeText = preset.freeText || "";
  currentSubfolderMode = preset.subfolderMode || "none";
}

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
    currentSubfolderMode = "none";
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
