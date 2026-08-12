/**
 * Quellverzeichnis oeffnen, Fotos einlesen, Sortierung der Liste.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

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
  scheduleSessionSave(); // frisch eingelesen: der bisherige Stand gilt nicht mehr
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
