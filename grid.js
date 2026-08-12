/**
 * Gridansicht: Filterung, Rendering, Tastaturnavigation, Quick Look.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

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
  scheduleSessionSave();

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
