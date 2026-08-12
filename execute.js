/**
 * Durchgang: Trockenlauf, Ausfuehren, Sitzungssicherung, Protokoll.
 *
 * Teil der Anwendung; klassisches Skript im gemeinsamen globalen Scope.
 * Die Ladereihenfolge in index.html entspricht der frueheren Reihenfolge
 * innerhalb von app.js und ist relevant - siehe CLAUDE.md.
 */

"use strict";

/* ============================================================
   AKTIONEN AUSFÜHREN (Verschieben / Löschen)
   ============================================================ */

const eventModalOverlay = document.getElementById("eventModalOverlay");

document.getElementById("btnUndoLastRun").addEventListener("click", undoLastRun);

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
    // Nur Löschungen -> keine Ereignisabfrage nötig, aber die Vorschau erst recht:
    // hier ist jede Zeile ein unumkehrbarer Schritt.
    openDryRunDialog("");
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

document.getElementById("btnEventOk").addEventListener("click", async () => {
  const eventText = document.getElementById("eventTextInput").value;
  eventModalOverlay.classList.add("hidden");
  await openDryRunDialog(eventText);
});

/* ---- Trockenlauf-Dialog ---- */

const dryRunOverlay = document.getElementById("dryRunOverlay");
/** Der gerade angezeigte Plan samt Ereignistext, bis er ausgeführt oder verworfen wird. */
let pendingRun = null;

/** Wie viele Zeilen die Vorschau höchstens auflistet, bevor sie zusammenfasst. */
const DRY_RUN_MAX_ROWS = 200;

async function openDryRunDialog(eventText) {
  const moveCount = state.photos.filter((p) => p.action === "move").length;
  if (moveCount > 0 && !state.targetDirHandle) {
    showToast("Bitte zuerst ein Zielverzeichnis wählen.", "error");
    return;
  }
  setStatus("Berechne Vorschau…");
  try {
    const plan = await planActions(eventText);
    pendingRun = { plan, eventText };
    renderDryRunDialog(plan);
    dryRunOverlay.classList.remove("hidden");
    document.getElementById("btnDryRunExecute").focus();
  } catch (e) {
    console.error("Vorschau konnte nicht berechnet werden", e);
    showToast("Vorschau konnte nicht berechnet werden: " + e.message, "error");
  } finally {
    setStatus("");
  }
}

function closeDryRunDialog() {
  dryRunOverlay.classList.add("hidden");
  pendingRun = null;
}

document.getElementById("btnDryRunCancel").addEventListener("click", closeDryRunDialog);
dryRunOverlay.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeDryRunDialog();
  }
  ev.stopPropagation();
});

document.getElementById("btnDryRunExecute").addEventListener("click", async () => {
  if (!pendingRun) return;
  const { plan, eventText } = pendingRun;
  closeDryRunDialog();
  await executeActions(eventText, plan);
});

/** Baut die Vorschauliste auf. */
function renderDryRunDialog(plan) {
  const zielName = state.targetDirHandle ? state.targetDirHandle.name : "–";

  /* Warnungen zuerst: sie sind der Grund, warum es diesen Dialog gibt. */
  const warnungen = [];
  if (plan.deletes.length > 0) {
    warnungen.push({
      stufe: "hart",
      text: `${plan.deletes.length} Datei(en) werden endgültig gelöscht. Die File System Access API kennt keinen Papierkorb – ein Wiederherstellen ist danach nicht möglich.`,
    });
  }
  if (plan.evadedCount > 0) {
    warnungen.push({
      stufe: "mild",
      text: `${plan.evadedCount} Zielname(n) sind bereits belegt. Diese Dateien bekommen ein Suffix (_1, _2, …); überschrieben wird nichts.`,
    });
  }
  const neueOrdner = new Set(plan.moves.map((m) => m.dirLabel).filter(Boolean));
  if (neueOrdner.size > 0) {
    warnungen.push({
      stufe: "mild",
      text: `Es wird in ${neueOrdner.size} Unterordner unterhalb von „${zielName}“ einsortiert; fehlende Ordner werden angelegt.`,
    });
  }
  document.getElementById("dryRunWarnings").innerHTML = warnungen
    .map((w) => `<div class="dryRunWarning${w.stufe === "mild" ? " mild" : ""}">${escapeHtml(w.text)}</div>`)
    .join("");

  /* Verschieben */
  document.getElementById("dryRunMoveCount").textContent = String(plan.moves.length);
  document.getElementById("dryRunMoveSection").classList.toggle("hidden", plan.moves.length === 0);
  const moveHtml = plan.moves.slice(0, DRY_RUN_MAX_ROWS).map((item) => {
    const ordner = item.dirLabel ? `<span class="dryRunDir">${escapeHtml(item.dirLabel)}/</span>` : "";
    return `<div class="dryRunRow${item.evaded ? " evaded" : ""}">` +
      `<span class="dryRunFrom" title="${escapeHtml(photoDisplayName(item.entry))}">${escapeHtml(photoDisplayName(item.entry))}</span>` +
      `<span class="dryRunArrow">→</span>` +
      `<span class="dryRunTo" title="${escapeHtml(item.dirLabel ? item.dirLabel + "/" + item.targetName : item.targetName)}">${ordner}${escapeHtml(item.targetName)}</span>` +
      `</div>`;
  }).join("");
  const moveRest = plan.moves.length - DRY_RUN_MAX_ROWS;
  document.getElementById("dryRunMoveList").innerHTML = moveHtml +
    (moveRest > 0 ? `<div class="dryRunMore">… und ${moveRest} weitere</div>` : "");

  /* Löschen */
  document.getElementById("dryRunDeleteCount").textContent = String(plan.deletes.length);
  document.getElementById("dryRunDeleteSection").classList.toggle("hidden", plan.deletes.length === 0);
  const deleteHtml = plan.deletes.slice(0, DRY_RUN_MAX_ROWS).map((entry) =>
    `<div class="dryRunRow deleteRow">` +
    `<span class="dryRunFrom" title="${escapeHtml(photoDisplayName(entry))}">🗑 ${escapeHtml(photoDisplayName(entry))}</span>` +
    `</div>`
  ).join("");
  const deleteRest = plan.deletes.length - DRY_RUN_MAX_ROWS;
  document.getElementById("dryRunDeleteList").innerHTML = deleteHtml +
    (deleteRest > 0 ? `<div class="dryRunMore">… und ${deleteRest} weitere</div>` : "");
}

/* ------------------------------------------------------------
   TROCKENLAUF (F2)
   ------------------------------------------------------------
   Die Sicherheitskette in executeActions() schützt vor technischem Datenverlust:
   sie stellt sicher, dass die Zieldatei heil angekommen ist, bevor die Quelle
   fällt. Wogegen sie nicht schützt, ist ein Irrtum des Nutzers - falsches
   Namensschema, falscher Zielordner, versehentlich 30 Fotos auf „Löschen".
   Deshalb wird der komplette Durchgang vorher trocken berechnet und angezeigt.

   Der Trockenlauf legt NICHTS an und ändert NICHTS. Zielordner, die es noch
   nicht gibt, werden auch nicht angelegt - dort kann folglich auch nichts
   kollidieren, was die Namensvergabe berücksichtigt.
   ------------------------------------------------------------ */

/**
 * @typedef {Object} MovePlanItem
 * @property {PhotoEntry} entry
 * @property {string[]} segments - Zielunterordner, relativ zum Zielverzeichnis
 * @property {string} dirLabel - derselbe Pfad als Text ("" = direkt im Ziel)
 * @property {string} targetName - vorgesehener Dateiname im Zielordner
 * @property {boolean} evaded - true, wenn wegen eines belegten Namens
 *   ausgewichen werden musste (Suffix _1, _2, …)
 */

/**
 * Berechnet den kompletten Durchgang, ohne etwas zu verändern.
 *
 * Verwendet dieselben Funktionen wie die Ausführung (buildFilename,
 * buildTargetSubfolderSegments, ensureUniqueName) - eine zweite, "ungefähre"
 * Berechnung wäre wertlos, weil sie genau in den Fällen abwiche, in denen die
 * Vorschau gebraucht wird.
 *
 * @param {string} eventText
 * @returns {Promise<{moves: MovePlanItem[], deletes: PhotoEntry[], evadedCount: number}>}
 */
async function planActions(eventText) {
  const moveTargets = state.photos.filter((p) => p.action === "move");
  const deleteTargets = state.photos.filter((p) => p.action === "delete");

  // Eigener Reservierungstopf: der Trockenlauf darf die Namensvergabe des
  // späteren echten Durchgangs nicht vorbelegen.
  const reserved = new Set();
  const dirCache = new Map();
  const moves = [];
  let counter = currentCounterStart;
  let evadedCount = 0;

  for (const entry of moveTargets) {
    const date = entry.captureDate || entry.fileDate || new Date();
    const segments = buildTargetSubfolderSegments({ date, event: eventText });
    const dirLabel = subfolderPathLabel(segments);
    const baseName = buildFilename({ date, event: eventText, counter }) || "foto";

    // Ordner nur AUFLÖSEN, nicht anlegen. Existiert er noch nicht, kann dort
    // auch keine Datei im Weg sein - die Namensprüfung beschränkt sich dann auf
    // die in diesem Durchgang bereits vergebenen Namen.
    const dirHandle = state.targetDirHandle
      ? await resolveExistingDirectory(state.targetDirHandle, segments, dirCache)
      : null;
    const pruefHandle = dirHandle || { async getFileHandle() { const e = new Error("nicht vorhanden"); e.name = "NotFoundError"; throw e; } };

    const targetName = await ensureUniqueName(pruefHandle, baseName, entry.ext, dirLabel, reserved);
    const evaded = targetName !== `${baseName}.${entry.ext}`;
    if (evaded) evadedCount++;

    moves.push({ entry, segments, dirLabel, targetName, evaded });
    counter++;
  }

  return { moves, deletes: deleteTargets, evadedCount };
}

/**
 * Löst einen Unterordnerpfad auf, OHNE fehlende Ebenen anzulegen. Liefert null,
 * sobald eine Ebene fehlt. Gegenstück zu resolveTargetDirectory() für den
 * Trockenlauf, der das Zielverzeichnis nicht verändern darf.
 */
async function resolveExistingDirectory(rootHandle, segments, cache) {
  const key = subfolderPathLabel(segments);
  if (cache.has(key)) return cache.get(key);

  let handle = rootHandle;
  for (const segment of segments) {
    if (!handle) break;
    try {
      handle = await handle.getDirectoryHandle(segment);
    } catch (e) {
      handle = null;
    }
  }
  cache.set(key, handle);
  return handle;
}

/**
 * Führt den Durchgang aus.
 * @param {string} eventText
 * @param {{moves: MovePlanItem[], deletes: PhotoEntry[]}} [plan] - vorberechneter
 *   Plan aus dem Trockenlauf. Fehlt er, wird er hier berechnet; die Zielnamen
 *   werden ohnehin frisch gegen das Dateisystem geprüft (siehe unten).
 */
async function executeActions(eventText, plan) {
  const moveTargets = state.photos.filter((p) => p.action === "move");
  const deleteTargets = state.photos.filter((p) => p.action === "delete");
  const total = moveTargets.length + deleteTargets.length;

  if (total === 0) return;

  if (moveTargets.length > 0 && !state.targetDirHandle) {
    showToast("Bitte zuerst ein Zielverzeichnis wählen.", "error");
    return;
  }

  // Die Unterordner-Zuordnung aus dem Plan übernehmen, damit ausgeführt wird,
  // was angezeigt wurde. Die DATEINAMEN werden trotzdem neu ermittelt: zwischen
  // Anzeige und Ausführung kann im Zielverzeichnis etwas hinzugekommen sein, und
  // der einzige Schutz vor dem Überschreiben ist die Prüfung unmittelbar davor.
  const plannedSegments = new Map();
  if (plan) for (const item of plan.moves) plannedSegments.set(item.entry, item.segments);

  // Löschen ist der einzige unumkehrbare Schritt in diesem Programm: removeEntry()
  // entfernt die Datei endgültig, die File System Access API kennt keinen Papierkorb.
  // Deshalb hier eine ausdrückliche Rückfrage - das Löschen einer Voreinstellung
  // oder eines Stichworts fragt schließlich auch nach.
  // Wurde der Durchgang über die Vorschau gestartet, ist bereits jede einzelne
  // Datei namentlich aufgeführt und der Hinweis auf den fehlenden Papierkorb
  // gegeben worden - dann wäre diese Rückfrage nur ein zweiter Klick auf
  // dieselbe Frage. Ohne Vorschau (direkter Aufruf) bleibt sie die letzte Instanz.
  if (deleteTargets.length > 0 && !plan) {
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
  const dirCache = new Map();
  const moveLog = [];

  // 1) Verschieben: kopieren ins Ziel (mit neuem Namen), dann im Quellordner löschen
  for (const entry of moveTargets) {
    try {
      const file = await entry.handle.getFile();
      const date = entry.captureDate || new Date(file.lastModified);
      const segments = plannedSegments.get(entry) || buildTargetSubfolderSegments({ date, event: eventText });
      const dirLabel = subfolderPathLabel(segments);
      // Erst hier wird der Ordner tatsächlich angelegt - ein abgebrochener
      // Trockenlauf soll keine leeren Ordner hinterlassen.
      const targetDir = await resolveTargetDirectory(state.targetDirHandle, segments, dirCache);
      const baseName = buildFilename({ date, event: eventText, counter });
      const finalName = await ensureUniqueName(targetDir, baseName || "foto", entry.ext, dirLabel);
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

      const targetFileHandle = await targetDir.getFileHandle(finalName, { create: true });
      const writable = await targetFileHandle.createWritable();
      await writable.write(fileContentToWrite);
      await writable.close();

      if (hasMetadataToWrite) {
        await writeXmpSidecar(targetDir, finalBaseNameWithoutExt, entry.assignedKeywords, description);
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
        targetDir,
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
          targetDir,
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

      // Erst jetzt protokollieren: was hier steht, ist tatsächlich geschehen.
      moveLog.push({
        entry,
        sourceName: entry.name,
        sourceLabel: photoDisplayName(entry),
        sourceDirHandle: entry.dirHandle,
        sourceRelPath: entry.relPath,
        dirLabel,
        targetDirHandle: targetDir,
        targetName: finalName,
        hasSidecar: hasMetadataToWrite,
        sidecarName: `${finalBaseNameWithoutExt}.xmp`,
      });

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
  const deleteLog = [];
  for (const entry of deleteTargets) {
    try {
      // Den Ordner nehmen, in dem die Datei TATSÄCHLICH liegt - beim Einlesen mit
      // Unterordnern ist das nicht zwingend das Quellverzeichnis.
      await entry.dirHandle.removeEntry(entry.name);
      deleteLog.push(photoDisplayName(entry));
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
  // Der gesicherte Sitzungsstand beschreibt jetzt einen überholten Bestand.
  scheduleSessionSave();

  // Protokoll und Rückgängig-Angebot: erst nach dem Durchgang, und nur, wenn
  // tatsächlich etwas passiert ist.
  if (moveLog.length > 0 || deleteLog.length > 0) {
    state.lastRunLog = {
      zeitpunkt: new Date(),
      quelle: state.sourceDirHandle ? state.sourceDirHandle.name : "?",
      ziel: state.targetDirHandle ? state.targetDirHandle.name : "–",
      verschoben: moveLog,
      geloescht: deleteLog,
      fehlgeschlagen: errors.slice(),
      // Ein bereits zurückgenommener Durchgang darf nicht ein zweites Mal
      // zurückgenommen werden - die Zieldateien gibt es dann nicht mehr.
      zurueckgenommen: false,
    };
    updateUndoButtonState();
    if (state.targetDirHandle) await writeRunProtocol(state.targetDirHandle, state.lastRunLog);
  }

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

/* ============================================================
   SITZUNG ÜBER EINEN RELOAD RETTEN (F4)
   ============================================================
   Bisher war jede Markierung und jedes zugewiesene Stichwort nach einem Reload
   verloren - bei einer Sichtung von 800 Fotos ein empfindlicher Verlust, und
   ein Reload passiert schneller als man denkt.

   Gesichert wird in IndexedDB (siehe session-store.js), weil nur dort
   Verzeichnis-Handles aufbewahrt werden können. Zwei Eigenheiten prägen den
   Ablauf:

   1. Ein wiederhergestellter Handle hat KEINE Berechtigung. Der Browser verlangt
      eine ausdrückliche Bestätigung, und die geht nur aus einer echten
      Nutzeraktion heraus. Deshalb wird beim Start nur ein Angebot eingeblendet.
   2. Der Dateibestand kann sich zwischenzeitlich geändert haben. Deshalb wird
      das Quellverzeichnis frisch eingelesen und die gespeicherten Markierungen
      werden auf das zugeordnet, was tatsächlich noch da ist. Fotos, die
      inzwischen fehlen, verschwinden stillschweigend - ihre Markierung auf eine
      andere Datei zu übertragen wäre die gefährlichere Variante.
   ============================================================ */

/** Wartezeit, bevor nach einer Änderung gesichert wird. */
const SESSION_SAVE_DELAY_MS = 800;
let sessionSaveTimer = null;

/** Schlüssel eines Fotos für die Zuordnung beim Wiederherstellen. */
function photoSessionKey(relPath, name) {
  // Als JSON-Paar statt mit einem Trennzeichen: Ordner- und Dateinamen duerfen
  // fast jedes Zeichen enthalten, ein selbst gewaehlter Trenner waere immer
  // irgendwann Teil eines echten Namens.
  return JSON.stringify([relPath, name]);
}

/**
 * Sichert den Zustand verzögert. Verzögert, weil beim Durchklicken einer
 * Fotoserie im Sekundentakt Markierungen fallen - jede einzeln zu schreiben
 * wäre reine Verschwendung.
 */
function scheduleSessionSave() {
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    persistSessionState();
  }, SESSION_SAVE_DELAY_MS);
}

/** Schreibt den aktuellen Zustand weg (oder verwirft ihn, wenn es nichts zu retten gibt). */
async function persistSessionState() {
  if (!state.sourceDirHandle) return;
  // Nur Fotos mit Markierung oder Stichworten sichern: alles andere lässt sich
  // aus dem Verzeichnis neu lesen und würde den Bestand nur aufblähen.
  const markierungen = state.photos
    .filter((p) => p.action !== "none" || p.assignedKeywords.length > 0)
    .map((p) => ({
      relPath: p.relPath,
      name: p.name,
      action: p.action,
      assignedKeywords: p.assignedKeywords.slice(),
    }));

  if (markierungen.length === 0) {
    await clearSessionState();
    return;
  }

  await saveSessionState({
    gesichertAm: Date.now(),
    sourceHandle: state.sourceDirHandle,
    targetHandle: state.targetDirHandle,
    includeSubfolders: state.includeSubfolders,
    sortKey: state.sortKey,
    sortDirection: state.sortDirection,
    markierungen,
  });
}

/**
 * Überträgt gesicherte Markierungen auf eine frisch eingelesene Fotoliste.
 * Rein rechnend und ohne Dateizugriff - damit prüfbar.
 *
 * @param {Array} photos - frisch eingelesene Einträge
 * @param {Array} markierungen - gesicherter Bestand
 * @returns {{uebernommen: number, verschwunden: number}}
 */
function applySavedMarks(photos, markierungen) {
  const nachSchluessel = new Map();
  for (const p of photos) nachSchluessel.set(photoSessionKey(p.relPath, p.name), p);

  let uebernommen = 0;
  let verschwunden = 0;
  for (const m of markierungen) {
    const treffer = nachSchluessel.get(photoSessionKey(m.relPath, m.name));
    if (!treffer) { verschwunden++; continue; }
    if (m.action === "move" || m.action === "delete") treffer.action = m.action;
    if (Array.isArray(m.assignedKeywords)) {
      treffer.assignedKeywords = m.assignedKeywords.filter((k) => typeof k === "string" && k.trim());
    }
    uebernommen++;
  }
  return { uebernommen, verschwunden };
}

/** Fragt die Berechtigung für einen gesicherten Handle ab und fordert sie nötigenfalls an. */
async function ensureHandlePermission(handle, mode) {
  if (!handle || typeof handle.queryPermission !== "function") return false;
  const optionen = { mode };
  if ((await handle.queryPermission(optionen)) === "granted") return true;
  return (await handle.requestPermission(optionen)) === "granted";
}

const resumeBanner = document.getElementById("resumeBanner");
/** Der beim Start gefundene, noch nicht angenommene Sitzungsstand. */
let pendingResume = null;

/** Blendet beim Start das Angebot ein, die letzte Sitzung fortzusetzen. */
async function offerSessionResume() {
  const record = await loadSessionState();
  if (!record || !record.sourceHandle || !Array.isArray(record.markierungen) || record.markierungen.length === 0) {
    return;
  }
  pendingResume = record;
  const anzahl = record.markierungen.length;
  const alter = new Date(record.gesichertAm || Date.now());
  document.getElementById("resumeBannerText").textContent =
    `Unterbrochene Sichtung vom ${formatProtocolTimestamp(alter)}: ` +
    `${anzahl} Foto(s) mit Markierung oder Stichworten in „${record.sourceHandle.name}“.`;
  resumeBanner.classList.remove("hidden");
}

function hideResumeBanner() {
  resumeBanner.classList.add("hidden");
  pendingResume = null;
}

document.getElementById("btnDiscardSession").addEventListener("click", async () => {
  hideResumeBanner();
  await clearSessionState();
  showToast("Gesicherter Sitzungsstand verworfen.", "info", 2500);
});

document.getElementById("btnResumeSession").addEventListener("click", async () => {
  const record = pendingResume;
  if (!record) return;
  try {
    // Der Klick ist die Nutzeraktion, aus der heraus der Browser die
    // Berechtigung überhaupt erst wieder erteilen kann.
    if (!(await ensureHandlePermission(record.sourceHandle, "readwrite"))) {
      showToast("Ohne Zugriff auf das Quellverzeichnis lässt sich die Sitzung nicht fortsetzen.", "error", 6000);
      return;
    }
    hideResumeBanner();

    state.sourceDirHandle = record.sourceHandle;
    document.getElementById("sourcePathLabel").textContent = record.sourceHandle.name;
    state.includeSubfolders = record.includeSubfolders === true;
    includeSubfoldersCheckbox.checked = state.includeSubfolders;
    if (record.sortKey) state.sortKey = record.sortKey;
    if (record.sortDirection) state.sortDirection = record.sortDirection;
    updateSortControlsUI();

    await loadPhotosFromSource();
    const ergebnis = applySavedMarks(state.photos, record.markierungen);
    recomputeActionCounts();
    updateAllCellStates();
    updateBottomBar();
    updateRunButtonState();

    // Das Zielverzeichnis nur übernehmen, wenn die Berechtigung noch steht -
    // ein zweiter Dialog direkt hinterher wäre zudringlich. Fehlt sie, wird das
    // Ziel wie gewohnt beim Ausführen angefordert.
    if (record.targetHandle && (await record.targetHandle.queryPermission({ mode: "readwrite" })) === "granted") {
      state.targetDirHandle = record.targetHandle;
      document.getElementById("targetPathLabel").textContent = record.targetHandle.name;
      updateRunButtonState();
    }

    const fehlend = ergebnis.verschwunden > 0
      ? ` ${ergebnis.verschwunden} Foto(s) aus dem gesicherten Stand sind nicht mehr im Ordner.`
      : "";
    showToast(`Sitzung fortgesetzt: ${ergebnis.uebernommen} Markierung(en) übernommen.${fehlend}`, "success", 6000);
  } catch (e) {
    console.error("Sitzung konnte nicht fortgesetzt werden", e);
    showToast("Sitzung konnte nicht fortgesetzt werden: " + e.message, "error", 6000);
  }
});

/* ============================================================
   PROTOKOLL & RÜCKGÄNGIG (F5)
   ============================================================
   Zwei getrennte Sicherheitsnetze mit unterschiedlicher Reichweite:

   1. Das PROTOKOLL ist eine Textdatei im Zielverzeichnis, die jeden Durchgang
      festhält - was wohin verschoben und was gelöscht wurde. Sie überlebt den
      Reload, den Programmwechsel und den Rechner. Für gelöschte Dateien ist sie
      das Einzige, was bleibt: die File System Access API kennt keinen
      Papierkorb, ein Wiederherstellen ist ausgeschlossen. Zu wissen, WAS weg
      ist, ist dann immer noch besser als nichts.

   2. RÜCKGÄNGIG bewegt die verschobenen Dateien an ihren Ursprungsort zurück -
      nur für den letzten Durchgang und nur in derselben Sitzung, weil dafür die
      Verzeichnis-Handles gebraucht werden. Gelöschte Dateien sind davon
      ausdrücklich nicht erfasst.

   Das Zurückbewegen benutzt dieselbe Reihenfolge wie das Verschieben: erst
   schreiben, dann prüfen, erst danach löschen. Ein Rückgängig, das die
   Zieldatei entfernt, bevor die zurückgeschriebene geprüft ist, wäre ein
   Datenverlustpfad in einer Funktion, die genau davor schützen soll.
   ============================================================ */

const PROTOCOL_FILE_NAME = "foto-importer-protokoll.txt";

/** Formatiert einen Zeitpunkt als "12.08.2026, 14:32:05". */
function formatProtocolTimestamp(date) {
  const zwei = (n) => String(n).padStart(2, "0");
  return `${zwei(date.getDate())}.${zwei(date.getMonth() + 1)}.${date.getFullYear()}, ` +
    `${zwei(date.getHours())}:${zwei(date.getMinutes())}:${zwei(date.getSeconds())}`;
}

/** Baut den Textblock eines Durchgangs für die Protokolldatei. */
function buildProtocolEntry(log) {
  const zeilen = [];
  zeilen.push(`=== Durchgang ${formatProtocolTimestamp(log.zeitpunkt)} ===`);
  zeilen.push(`Quelle: ${log.quelle}`);
  zeilen.push(`Ziel:   ${log.ziel}`);
  zeilen.push("");

  zeilen.push(`Verschoben (${log.verschoben.length}):`);
  for (const m of log.verschoben) {
    const ziel = m.dirLabel ? `${m.dirLabel}/${m.targetName}` : m.targetName;
    zeilen.push(`  ${m.sourceLabel}  ->  ${ziel}`);
  }
  if (log.verschoben.length === 0) zeilen.push("  (keine)");
  zeilen.push("");

  zeilen.push(`Geloescht (${log.geloescht.length}) - endgueltig, kein Papierkorb:`);
  for (const name of log.geloescht) zeilen.push(`  ${name}`);
  if (log.geloescht.length === 0) zeilen.push("  (keine)");

  if (log.fehlgeschlagen.length > 0) {
    zeilen.push("");
    zeilen.push(`Fehlgeschlagen (${log.fehlgeschlagen.length}):`);
    for (const fehler of log.fehlgeschlagen) zeilen.push(`  ${fehler}`);
  }
  zeilen.push("");
  return zeilen.join("\n");
}

/**
 * Hängt den Durchgang an die Protokolldatei im Zielverzeichnis an.
 *
 * Bewusst eine einzige, fortgeschriebene Datei statt einer pro Durchgang: sie
 * ist als Ganzes lesbar und wandert beim Kopieren des Archivs mit. Angehängt
 * wird per Lesen und Neuschreiben - die File System Access API kennt zwar einen
 * Append-Modus, aber ein vollständig neu geschriebener kleiner Textbestand ist
 * hier robuster als ein Positionszeiger.
 *
 * Scheitert das Schreiben, ist das kein Grund, den Durchgang als gescheitert zu
 * melden: die Fotos liegen bereits richtig. Es gibt einen Hinweis, mehr nicht.
 */
async function writeRunProtocol(targetDirHandle, log) {
  try {
    let bisher = "";
    try {
      const vorhanden = await targetDirHandle.getFileHandle(PROTOCOL_FILE_NAME);
      bisher = await (await vorhanden.getFile()).text();
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
      bisher =
        "Protokoll des Foto-Importers.\n" +
        "Haelt fest, was in welchem Durchgang wohin verschoben und was geloescht wurde.\n" +
        "Geloeschte Dateien sind endgueltig weg - diese Datei ist der einzige Nachweis darueber.\n\n";
    }

    const handle = await targetDirHandle.getFileHandle(PROTOCOL_FILE_NAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bisher + buildProtocolEntry(log) + "\n");
    await writable.close();
  } catch (e) {
    console.warn("Protokolldatei konnte nicht geschrieben werden:", e);
    showToast("Hinweis: Die Protokolldatei im Zielverzeichnis konnte nicht geschrieben werden.", "info", 5000);
  }
}

/** Blendet den Rückgängig-Knopf ein, sobald es etwas zurückzunehmen gibt. */
function updateUndoButtonState() {
  const btn = document.getElementById("btnUndoLastRun");
  if (!btn) return;
  const log = state.lastRunLog;
  const moeglich = !!log && !log.zurueckgenommen && log.verschoben.length > 0;
  btn.classList.toggle("hidden", !moeglich);
  if (moeglich) {
    btn.textContent = `↩ ${log.verschoben.length} zurück`;
    btn.title = `Die ${log.verschoben.length} verschobenen Datei(en) des letzten Durchgangs an ihren Ursprungsort zurückbewegen.` +
      (log.geloescht.length > 0 ? ` Die ${log.geloescht.length} gelöschte(n) Datei(en) sind davon nicht erfasst.` : "");
  }
}

/**
 * Bewegt die verschobenen Dateien des letzten Durchgangs zurück.
 *
 * Reihenfolge je Datei, identisch zum Verschieben: Zieldatei lesen, in den
 * Ursprungsordner schreiben, die zurückgeschriebene Datei frisch vom
 * Dateisystem prüfen - und erst danach die Datei im Zielverzeichnis löschen.
 * Schlägt die Prüfung fehl, bleibt die Zieldatei liegen; im schlimmsten Fall
 * existiert die Datei dann zweimal, was allemal besser ist als keinmal.
 */
async function undoLastRun() {
  const log = state.lastRunLog;
  if (!log || log.zurueckgenommen || log.verschoben.length === 0) return;

  const hinweisGeloescht = log.geloescht.length > 0
    ? `\n\nDie ${log.geloescht.length} gelöschte(n) Datei(en) lassen sich NICHT wiederherstellen - sie sind endgültig weg.`
    : "";
  if (!confirm(
    `${log.verschoben.length} Datei(en) werden aus dem Zielverzeichnis an ihren Ursprungsort zurückbewegt.` +
    hinweisGeloescht + `\n\nFortfahren?`
  )) return;

  showProgress(true, "Mache rückgängig…", 0, log.verschoben.length);
  const zurueck = [];
  const fehler = [];
  let done = 0;

  for (const m of log.verschoben) {
    try {
      const zielHandle = await m.targetDirHandle.getFileHandle(m.targetName);
      const zielDatei = await zielHandle.getFile();
      const inhalt = new Uint8Array(await zielDatei.arrayBuffer());

      // Im Ursprungsordner einen freien Namen suchen: in der Zwischenzeit kann
      // dort eine neue Datei gleichen Namens liegen (z. B. von der Kamera).
      const punkt = m.sourceName.lastIndexOf(".");
      const basis = punkt === -1 ? m.sourceName : m.sourceName.slice(0, punkt);
      const endung = punkt === -1 ? "" : m.sourceName.slice(punkt + 1);
      const name = await ensureUniqueName(m.sourceDirHandle, basis, endung, `zurueck|${m.sourceRelPath}`);

      const neuHandle = await m.sourceDirHandle.getFileHandle(name, { create: true });
      const writable = await neuHandle.createWritable();
      await writable.write(inhalt);
      await writable.close();

      // Dieselbe Prüfung wie beim Verschieben, bevor gelöscht wird.
      const pruefung = await verifyMovedFile(m.sourceDirHandle, name, inhalt, getExtension(name), null, null);
      if (!pruefung.ok) {
        throw new Error(`Prüfung der zurückgeschriebenen Datei fehlgeschlagen: ${pruefung.reason}. Die Datei im Zielverzeichnis wurde NICHT gelöscht.`);
      }

      await m.targetDirHandle.removeEntry(m.targetName);
      if (m.hasSidecar) {
        // Die Sidecar-Datei gehört zur Zielfassung; im Quellordner hat sie
        // nichts verloren. Ihr Fehlen ist kein Fehler.
        try { await m.targetDirHandle.removeEntry(m.sidecarName); } catch (e) { /* war nicht da */ }
      }

      // Das Foto wieder in die Liste aufnehmen - mit frischem Handle, denn das
      // alte zeigte auf die inzwischen gelöschte Ursprungsdatei.
      const eintrag = createPhotoEntry(name, neuHandle, m.sourceDirHandle, m.sourceRelPath);
      eintrag.captureDate = m.entry.captureDate;
      eintrag.fileDate = m.entry.fileDate;
      eintrag.fileSize = zielDatei.size;
      eintrag.assignedKeywords = m.entry.assignedKeywords.slice();
      eintrag.existingKeywords = m.entry.existingKeywords;
      eintrag.existingDescription = m.entry.existingDescription;
      zurueck.push(eintrag);
    } catch (e) {
      console.error("Rückgängig fehlgeschlagen für", m.targetName, e);
      fehler.push(`${m.targetName}: ${e.message}`);
    }
    done++;
    showProgress(true, "Mache rückgängig…", done, log.verschoben.length, m.targetName);
  }

  showProgress(false);
  log.zurueckgenommen = true;
  updateUndoButtonState();

  if (zurueck.length > 0) {
    state.photos = state.photos.concat(zurueck);
    sortPhotoEntries(state.photos, state.sortKey, state.sortDirection);
    state.selectedIndices.clear();
    state.cursorIndex = 0;
    state.activeFilter = "all";
    updateFilterButtonsUI();
    recomputeActionCounts();
    renderGrid();
    updateBottomBar();
  }

  if (state.targetDirHandle) {
    await writeRunProtocol(state.targetDirHandle, {
      zeitpunkt: new Date(),
      quelle: log.ziel,
      ziel: log.quelle,
      verschoben: zurueck.map((e) => ({ sourceLabel: `(rückgängig) ${e.name}`, dirLabel: e.relPath, targetName: e.name })),
      geloescht: [],
      fehlgeschlagen: fehler,
    });
  }

  if (fehler.length > 0) {
    showToast(`${zurueck.length} zurückbewegt, ${fehler.length} fehlgeschlagen. Details in der Konsole.`, "error", 8000);
  } else {
    showToast(`${zurueck.length} Datei(en) zurückbewegt.`, "success");
  }
}

/**
 * Namen, die in DIESEM Durchgang bereits vergeben wurden. Nötig zusätzlich zur
 * Prüfung auf dem Dateisystem, weil die Datei zu einem gerade reservierten Namen
 * noch nicht geschrieben ist, wenn der Name für das nächste Foto gesucht wird.
 * Wird zu Beginn jedes Durchgangs geleert - das Dateisystem ist die maßgebliche
 * Instanz, ein Altbestand aus einem früheren (womöglich anderen) Zielverzeichnis
 * würde nur unnötige "_1"-Suffixe erzeugen.
 *
 * Die Namen sind mit dem ZIELORDNER geschlüsselt ("2026/2026-08|foto.jpg"). Seit
 * es Unterordner im Ziel gibt, ist ein Name nur innerhalb seines Ordners belegt -
 * ein gemeinsamer Topf würde in jedem weiteren Ordner überflüssige "_1"-Suffixe
 * erzeugen, obwohl der Name dort frei ist.
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
async function ensureUniqueName(targetDirHandle, baseName, ext, dirKey, reserved) {
  const belegte = reserved || usedTargetNames;
  const schluessel = (name) => `${dirKey || ""}|${name}`;
  let candidate = `${baseName}.${ext}`;
  let n = 1;
  while (
    belegte.has(schluessel(candidate)) ||
    belegte.has(schluessel(sidecarNameFor(candidate))) ||
    (await targetFileExists(targetDirHandle, candidate)) ||
    (await targetFileExists(targetDirHandle, sidecarNameFor(candidate)))
  ) {
    candidate = `${baseName}_${n}.${ext}`;
    n++;
    if (n > 9999) {
      throw new Error(`Kein freier Dateiname für „${baseName}.${ext}" im Zielverzeichnis gefunden.`);
    }
  }
  belegte.add(schluessel(candidate));
  belegte.add(schluessel(sidecarNameFor(candidate)));
  return candidate;
}
