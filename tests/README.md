# Tests

```bash
node tests/run-all.js
```

Das ist der eine Befehl, der alles Automatisierbare der
[Definition of Done](../CLAUDE.md#definition-of-done) abarbeitet. Exit-Code 0
heißt bestanden.

## Was geprüft wird

| Schritt | Was | Braucht |
|---|---|---|
| 1 | Syntax aller Skripte (`node --check`) | Node |
| 2 | Keine doppelten globalen Namen | Node |
| 3 | Ladereihenfolge der Skripte | Node |
| 4 | Eingebaute Hilfe passt zu `HANDBUCH.md` | Node |
| 5 | Unit-Tests der Binärformat-Module | Node |
| 6 | Browser-Tests der Anwendungslogik | Node + Chromium |

**Schritt 3** fängt den Fall ab, der durch die Aufteilung der Anwendung auf
mehrere Dateien möglich wurde: Top-Level-Code, der eine Funktion aus einer erst
später geladenen Datei benutzt. Gefährlich daran ist nicht der offensichtliche
Fall – der scheitert beim ersten Start –, sondern der Aufruf in einem Zweig, den
nur manche Nutzer nehmen.

**Schritt 4** ruft `node tools/sync-help.js --check` auf. `help-content.js` wird
aus `HANDBUCH.md` erzeugt; laufen beide auseinander, behauptet die Hilfe in der
App etwas anderes als das Handbuch.

Schritt 6 wird **übersprungen**, wenn Playwright nicht installiert ist – die
Zusammenfassung sagt das dann ausdrücklich und markiert den Schritt mit `–`
statt `✓`. „Nicht gelaufen" als „bestanden" zu melden, wäre die gefährlichere
Lüge. Die Browser-Tests lassen sich in dem Fall von Hand ausführen (siehe
unten).

`tests/run-browser.js` einzeln aufgerufen nutzt dafür eigene Exit-Codes:
`0` bestanden, `1` fehlgeschlagen, `3` übersprungen.

## Die einzelnen Teile

### Unit-Tests – `*.test.js`

```bash
node --test tests/*.test.js
```

Decken die Module ab, die auf Binärformaten arbeiten: `exif.js`, `iptc-iim.js`,
`photoshop-irb.js`, `xmp-packet.js`, `jpeg-segments.js`, `raw-preview.js`. Sie laufen mit
`node:test` und `node:assert` – beides Bordmittel, **keine Abhängigkeiten**. Die
Module exportieren am Dateiende per `module.exports` und lassen sich deshalb
ohne jede Anpassung per `require()` laden.

Das ist der Teil der Anwendung, in dem ein Fehler Bilddaten beschädigt. Die
wichtigste Zusicherung steht in `jpeg-segments.test.js`: die Bytes ab dem
Start-of-Scan bleiben beim Schreiben von Metadaten **byteidentisch**. Genau
diesen Bereich vergleicht die Anwendung per SHA-256, bevor sie eine Quelldatei
löscht.

Die Testdaten sind synthetisch (`helpers.js` baut JPEG- und EXIF-Strukturen
byteweise auf). Absicht: ein Test soll sagen können, *welches* Byte falsch ist,
und das Repository soll keine Megabyte an Beispielfotos mitschleppen.

### Browser-Tests – `browser.html` + `browser-suite.js`

Die Anwendungsdateien lassen sich nicht in Node laden – sie greifen beim Start
auf `document` zu. Diese Tests laufen deshalb im Browser.

**Von Hand:**

```bash
python3 -m http.server 8000
# dann http://localhost:8000/tests/browser.html öffnen
```

**Automatisiert:**

```bash
node tests/run-browser.js
```

Dieses Skript bringt einen eigenen Webserver aus Node-Bordmitteln mit und
steuert einen Chromium ohne sichtbares Fenster. Playwright ist die einzige
Zutat, die es nicht selbst mitbringen kann:

```bash
npm install --no-save playwright && npx playwright install chromium
```

`--no-save` und der Eintrag in `.gitignore` sorgen dafür, dass daraus keine
Projekt-Abhängigkeit wird. Ist bereits ein Chromium vorhanden, geht auch:

```bash
PLAYWRIGHT_CHROMIUM=/pfad/zu/chromium node tests/run-browser.js
```

#### Warum der Umweg über ein iframe

`browser.html` lädt die echte `index.html` in ein iframe und injiziert
`browser-suite.js` **in dieses Fenster**. Grund: die Anwendungsdateien sind
klassische Skripte, deren Zustand (`state`, `currentFormatTokens`, …) als
Top-Level-`const`/`let` im globalen lexikalischen Scope liegt und deshalb *nicht*
über `window.` erreichbar ist. Ein Skript, das im selben Realm nachgeladen wird,
sieht diese Bindungen dagegen ganz normal – ohne dass eine Test-Hintertür
eingebaut werden müsste.

#### Attrappen statt echter Dateien

`executeActions()` läuft in den Tests **vollständig** durch – Metadaten
schreiben, zurücklesen, prüfen, Quelldatei löschen –, aber gegen nachgebildete
`FileSystemDirectoryHandle`-Objekte. Es wird keine echte Datei angefasst. Nur so
sind diese Tests gefahrlos wiederholbar: der echte Pfad löscht endgültig.

Abgedeckt sind unter anderem der Überschreibschutz, der Sidecar-Fallback, die
Bereinigung von Dateinamen, die Löschabfrage, der Vorschau-Cache, der
Trockenlauf, die Zielunterordner, das Protokoll, das Rückgängig und das
Fortsetzen einer Sitzung – sowie die Gegenproben: eine verfälschte Zieldatei,
eine verfälschte Sidecar-Datei und ein misslungenes Zurückschreiben müssen das
Löschen jeweils *verhindern*.

## Was die Tests NICHT abdecken

- **Das echte Dateisystem.** Attrappen bilden die File System Access API nach,
  ersetzen sie aber nicht. Berechtigungsdialoge, Netzlaufwerke, volle
  Datenträger, gleichzeitige Zugriffe – nichts davon wird geprüft.
- **Echte Kameradateien.** Weder RAW-Formate noch HEIC noch die EXIF-Eigenheiten
  einzelner Hersteller.
- **Die Oberfläche.** Rendering, Layout, Drag & Drop und der Leuchttisch werden
  nicht angefasst.

Vor jedem Commit am Verschiebe- oder Metadatenpfad gehört deshalb weiterhin ein
Durchlauf mit **Kopien echter Fotos in einem Wegwerf-Ordner** dazu.

## Einen Test hinzufügen

- **Binärformat-Modul:** eine `*.test.js` in diesem Verzeichnis anlegen, das
  Modul per `require("../modul.js")` laden. `run-all.js` findet sie von selbst.
- **Anwendungslogik:** einen Block in `browser-suite.js` ergänzen –
  `bereich("…")` für die Überschrift, `pruefe(name, bedingung, detail)` je
  Zusicherung. Das `detail`-Argument erscheint im Ergebnis und sollte den
  *tatsächlichen* Wert zeigen; bei einem Fehlschlag ist das der Unterschied
  zwischen „irgendwas stimmt nicht" und einer Diagnose.
