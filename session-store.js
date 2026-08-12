/**
 * Speichert den Sitzungszustand in IndexedDB, damit ein Neuladen der Seite eine
 * angefangene Sichtung nicht vernichtet.
 *
 * Warum IndexedDB und nicht localStorage: nur IndexedDB kann
 * FileSystemDirectoryHandle-Objekte aufbewahren. localStorage speichert
 * ausschließlich Zeichenketten, und ein Verzeichnis-Handle lässt sich nicht
 * sinnvoll als Text darstellen - der Pfad allein reicht nicht, weil sich daraus
 * ohne erneuten Auswahldialog kein Zugriff herstellen ließe.
 *
 * Wichtig: ein wiederhergestellter Handle bringt seine Berechtigung NICHT mit.
 * Der Browser verlangt für den erneuten Zugriff eine ausdrückliche Bestätigung
 * durch den Nutzer, und die ist nur aus einer echten Nutzeraktion heraus
 * möglich. Deshalb wird beim Start nur ein Angebot eingeblendet, statt die
 * Sitzung von selbst wiederherzustellen.
 *
 * Gespeichert wird bewusst wenig: die beiden Verzeichnis-Handles und je Foto
 * Pfad, Name, Markierung und zugewiesene Stichworte. Keine Vorschaubilder, keine
 * Dateiinhalte - alles, was sich aus dem Dateisystem neu lesen lässt, wird auch
 * neu gelesen. Der gespeicherte Bestand bleibt damit klein und kann nicht
 * veralten.
 */

const SESSION_DB_NAME = "fotoImporter";
const SESSION_DB_VERSION = 1;
const SESSION_STORE_NAME = "session";
const SESSION_RECORD_KEY = "current";

/** Öffnet (und erstellt beim ersten Mal) die Datenbank. */
function openSessionDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB steht nicht zur Verfügung."));
      return;
    }
    const request = indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        db.createObjectStore(SESSION_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Führt eine Operation auf dem Store aus und schließt die Verbindung wieder. */
async function withSessionStore(mode, arbeit) {
  const db = await openSessionDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, mode);
      const request = arbeit(tx.objectStore(SESSION_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Sichert den Sitzungszustand. Fehler werden geschluckt und nur auf der Konsole
 * vermerkt: das Speichern ist eine Bequemlichkeit, kein Teil des Arbeitsablaufs -
 * es darf das Markieren von Fotos niemals unterbrechen.
 * @param {Object} record
 */
async function saveSessionState(record) {
  try {
    await withSessionStore("readwrite", (store) => store.put(record, SESSION_RECORD_KEY));
    return true;
  } catch (e) {
    console.warn("Sitzungszustand konnte nicht gesichert werden:", e);
    return false;
  }
}

/**
 * Liest den gesicherten Sitzungszustand.
 * @returns {Promise<Object|null>}
 */
async function loadSessionState() {
  try {
    const record = await withSessionStore("readonly", (store) => store.get(SESSION_RECORD_KEY));
    return record || null;
  } catch (e) {
    console.warn("Sitzungszustand konnte nicht gelesen werden:", e);
    return null;
  }
}

/** Verwirft den gesicherten Sitzungszustand. */
async function clearSessionState() {
  try {
    await withSessionStore("readwrite", (store) => store.delete(SESSION_RECORD_KEY));
    return true;
  } catch (e) {
    console.warn("Sitzungszustand konnte nicht verworfen werden:", e);
    return false;
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    saveSessionState,
    loadSessionState,
    clearSessionState,
    SESSION_DB_NAME,
    SESSION_STORE_NAME,
    SESSION_RECORD_KEY,
  };
}
