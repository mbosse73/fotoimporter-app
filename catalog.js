/**
 * Stichwortkatalog: Pool, Gruppen, Sets, Favoriten.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

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
