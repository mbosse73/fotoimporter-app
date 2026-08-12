/**
 * Fortschritt, Hilfe, Shortcut-Leisten, Initialisierung.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

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

/*
 * HELP_CHAPTERS steht in help-content.js und wird aus HANDBUCH.md erzeugt
 * (node tools/sync-help.js). Frueher standen dieselben Inhalte hier ein
 * zweites Mal - zwei Quellen fuer dieselbe Aussage laufen zuverlaessig
 * auseinander. Aenderungen gehoeren ins Handbuch.
 */

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
  offerSessionResume();
});
