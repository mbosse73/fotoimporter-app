/**
 * Namensschema, Zielunterordner, Voreinstellungen, Einstellungs-Export.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

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

document.getElementById("subfolderMode").addEventListener("change", (ev) => {
  currentSubfolderMode = ev.target.value;
  updateFormatPreview();
});

/**
 * Füllt die Auswahlliste der Unterordner-Gliederung aus SUBFOLDER_MODES - eine
 * Quelle für Werte, Beschriftungen und Beispiele. Wird beim Öffnen des Dialogs
 * aufgerufen und nicht beim Laden: SUBFOLDER_MODES steht weiter unten in der
 * Datei und wäre zum Zeitpunkt dieses Skriptabschnitts noch nicht initialisiert.
 */
function renderSubfolderModeSelect() {
  const select = document.getElementById("subfolderMode");
  select.innerHTML = "";
  for (const [wert, info] of Object.entries(SUBFOLDER_MODES)) {
    const opt = document.createElement("option");
    opt.value = wert;
    opt.textContent = info.example ? `${info.label}  (${info.example}/)` : info.label;
    select.appendChild(opt);
  }
  select.value = currentSubfolderMode;
}

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

/* ------------------------------------------------------------
   ZIELUNTERORDNER (F3)
   ------------------------------------------------------------
   Statt alles in einen Ordner zu schütten, kann der Zielpfad nach Datum
   und/oder Ereignis gegliedert werden. Der Aufbau ist bewusst eine feste
   Auswahl und kein zweiter Baukasten: die Ordnerstruktur eines Archivs ist eine
   Entscheidung, die man einmal trifft und dann nie wieder ändern will - dafür
   sind fünf benannte Varianten verständlicher als frei kombinierbare Bausteine.
   ------------------------------------------------------------ */

const SUBFOLDER_MODES = {
  none: { label: "Kein Unterordner", example: "" },
  year: { label: "Jahr", example: "2026" },
  yearMonth: { label: "Jahr / Jahr-Monat", example: "2026/2026-08" },
  yearMonthDay: { label: "Jahr / Jahr-Monat / Jahr-Monat-Tag", example: "2026/2026-08/2026-08-12" },
  event: { label: "Ereignis", example: "Sommerurlaub" },
  yearEvent: { label: "Jahr / Ereignis", example: "2026/Sommerurlaub" },
};

/**
 * Baut die Ordnersegmente für ein einzelnes Foto.
 *
 * Jedes Segment durchläuft dieselbe Bereinigung wie ein Dateiname - ein
 * Ereignistext mit Schrägstrich würde sonst eine zusätzliche Ordnerebene
 * erzeugen, und getDirectoryHandle() weist jeden Namen mit Pfadseparator
 * ohnehin zurück. Leere Segmente (Ereignis ohne Eingabe) fallen weg, sonst
 * entstünde ein Ordner ohne Namen.
 *
 * @param {{date: Date, event: string}} ctx
 * @returns {string[]}
 */
function buildTargetSubfolderSegments(ctx) {
  const d = ctx.date;
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const event = sanitizeFileBaseName(sanitizeEventText(ctx.event || ""));

  let segments;
  switch (currentSubfolderMode) {
    case "year": segments = [yyyy]; break;
    case "yearMonth": segments = [yyyy, `${yyyy}-${mm}`]; break;
    case "yearMonthDay": segments = [yyyy, `${yyyy}-${mm}`, `${yyyy}-${mm}-${dd}`]; break;
    case "event": segments = [event]; break;
    case "yearEvent": segments = [yyyy, event]; break;
    default: segments = []; break;
  }
  return segments.map((s) => sanitizeFileBaseName(s)).filter((s) => s.length > 0);
}

/** Der Pfad als Text, für Anzeige, Protokoll und als Schlüssel der Namensvergabe. */
function subfolderPathLabel(segments) {
  return segments.join("/");
}

/**
 * Löst einen Unterordnerpfad unterhalb des Zielverzeichnisses auf und legt
 * fehlende Ebenen an. Innerhalb eines Durchgangs wird das Ergebnis gecacht:
 * bei 500 Fotos desselben Tages würde sonst 500-mal derselbe Ordner aufgelöst.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string[]} segments
 * @param {Map<string, FileSystemDirectoryHandle>} cache
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function resolveTargetDirectory(rootHandle, segments, cache) {
  const key = subfolderPathLabel(segments);
  if (cache.has(key)) return cache.get(key);

  let handle = rootHandle;
  const bisher = [];
  for (const segment of segments) {
    bisher.push(segment);
    const teilKey = subfolderPathLabel(bisher);
    if (cache.has(teilKey)) {
      handle = cache.get(teilKey);
      continue;
    }
    handle = await handle.getDirectoryHandle(segment, { create: true });
    cache.set(teilKey, handle);
  }
  cache.set(key, handle);
  return handle;
}

function updateFormatPreview() {
  const exampleCtx = {
    date: new Date(),
    event: "Geburtstag_Oma",
    counter: currentCounterStart,
    ext: "jpg",
  };
  const name = buildFilename(exampleCtx);
  const ordner = subfolderPathLabel(buildTargetSubfolderSegments(exampleCtx));
  document.getElementById("formatPreview").innerHTML =
    `Beispiel: <b>${escapeHtml(ordner ? ordner + "/" : "")}${escapeHtml(name || "(leer)")}.jpg</b>`;
}

document.getElementById("btnRenameSettings").addEventListener("click", () => {
  renderFormatBuilder();
  document.getElementById("counterStart").value = String(currentCounterStart);
  document.getElementById("counterDigits").value = String(currentCounterDigits);
  document.getElementById("freeText").value = currentFreeText;
  renderSubfolderModeSelect();
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

document.getElementById("presetSelect").addEventListener("change", (ev) => {
  const name = ev.target.value;
  if (!name) return;
  loadPresetIntoBuilder(name);
  renderFormatBuilder();
  document.getElementById("counterStart").value = String(currentCounterStart);
  document.getElementById("counterDigits").value = String(currentCounterDigits);
  document.getElementById("freeText").value = currentFreeText;
  renderSubfolderModeSelect();
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
    subfolderMode: currentSubfolderMode,
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
