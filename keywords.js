/**
 * Stichworte an Fotos zuweisen; Zuweisungspanel; Statusleiste.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

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
  scheduleSessionSave();
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
