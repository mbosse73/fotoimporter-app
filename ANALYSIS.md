# Analyse: Foto-Importer

Ergebnis eines Repo-Onboardings vom 11.08.2026, ursprünglich erhoben auf Commit
`3128f35`. Fortgeschrieben nach Umsetzung der Korrekturen, des Test-Setups und
**sämtlicher Verbesserungsvorschläge aus Abschnitt 3**.

> **So ist dieses Dokument zu lesen:**
>
> - **Abschnitt 1** beschreibt die Architektur auf dem **aktuellen** Stand.
> - **Abschnitt 2** listet die Befunde und beschreibt den Zustand **vor** der
>   Korrektur. Die Beschreibungen bleiben stehen, weil sie die Begründung der
>   jeweiligen Lösung sind – sie sind kein offener Mangel mehr. Die
>   Fundstellen dort verweisen auf das damalige `app.js`; diese Datei gibt es
>   nicht mehr, ihr Inhalt liegt seit V5 in elf Dateien (siehe Abschnitt 1).
> - **Abschnitt 3** enthält die Vorschläge, jeweils mit Umsetzungsstand.
> - **Abschnitt 4** hält fest, was tatsächlich geändert wurde.
>
> Alle Befunde aus Abschnitt 2 **und** alle Vorschläge aus Abschnitt 3 sind
> umgesetzt. Was jetzt noch offen wäre, steht am Ende von Abschnitt 3.

---

## 1. Architektur und Überblick

### Was die App tut

Foto-Importer ist ein Werkzeug für den Schritt zwischen Speicherkarte und
Fotoarchiv. Der Nutzer öffnet ein Quellverzeichnis, sichtet die Fotos im Grid
oder im Leuchttisch, markiert jedes Foto als „verschieben" oder „löschen",
vergibt Stichworte und stößt dann den Durchlauf an: markierte Fotos wandern nach
einem konfigurierbaren Namensschema umbenannt ins Zielverzeichnis – inklusive in
die Datei geschriebener IPTC/XMP-Metadaten –, zum Löschen markierte werden
entfernt.

### Architekturform

Eine **klassische Web-Seite ohne Build-Schritt**. Kein Framework, keine
Dependencies, kein Bundler, kein Transpiler, kein Server. Zwanzig
JavaScript-Dateien werden per `<script src>` in den globalen Scope geladen, das
gesamte CSS liegt inline in der `index.html`.

Das ist für diese App eine tragfähige Entscheidung und kein Versäumnis: sie soll
lokal und offline über die File System Access API auf echten Fotos arbeiten, und
je weniger zwischen Quelltext und Ausführung steht, desto überprüfbarer ist, was
tatsächlich mit den Dateien passiert.

Erkauft wird das mit einer Kost, die geblieben ist: der geteilte globale Scope
macht jeden neuen Top-Level-Namen zu einem Kollisionsrisiko. `run-all.js` prüft
deshalb auf Dubletten. Seit der Aufteilung kommt eine zweite Regel dazu –
Funktionsdeklarationen werden nur innerhalb ihrer eigenen Datei hochgezogen,
Top-Level-Code sieht also nur zuvor Geladenes. Auch das wird geprüft
(`tests/check-load-order.js`).

### Schichtung

Faktisch gibt es zwei sauber getrennte Schichten:

**Unten – Binärformat- und Infrastrukturmodule** (`exif.js`,
`exif-extended.js`, `jpeg-segments.js`, `iptc-iim.js`, `photoshop-irb.js`,
`xmp-packet.js`, `raw-preview.js`, `session-store.js`). Reine, weitgehend
DOM-freie Funktionen, die auf `Uint8Array` bzw. IndexedDB arbeiten. Alle
exportieren am Dateiende per `module.exports` und sind dadurch direkt in Node
ladbar – worauf die Unit-Tests in `tests/` aufsetzen. Diese Schicht ist der
qualitativ stärkste Teil des Projekts: die Formatbehandlung ist
spezifikationsnah, kommentiert und defensiv.

Dazu kommt `help-content.js` – **erzeugt** aus `HANDBUCH.md`, nicht von Hand
gepflegt.

**Oben – elf Anwendungsdateien** in fester Ladereihenfolge: `state.js`,
`source.js`, `metadata.js`, `thumbnails.js`, `grid.js`, `keywords.js`,
`lightbox.js`, `naming.js`, `execute.js`, `catalog.js`, `overlays.js`. Sie sind
aus dem früheren `app.js` entlang seiner Banner-Abschnitte entstanden; die
Reihenfolge entspricht der früheren Reihenfolge innerhalb der Datei. Größte Datei
ist `execute.js` mit gut 1000 Zeilen (Trockenlauf, Durchgang, Sitzungssicherung,
Protokoll, Rückgängig).

### Zentrale Einstiegspunkte

| Was | Wo |
|---|---|
| Quellordner öffnen und Fotos einlesen | `loadPhotosFromSource()` |
| Gridansicht aufbauen | `renderGrid()` |
| Thumbnail-Lazy-Loading | `pumpThumbQueue()` / `loadOneThumbnail()` |
| Durchgang vorausberechnen (Trockenlauf) | `planActions()` |
| Aktionen ausführen (Kern der App) | `executeActions()` |
| Durchgang zurücknehmen | `undoLastRun()` |
| Vorschau aus einer RAW-Datei schneiden | `extractRawPreviewBlob()` → `findEmbeddedJpegRanges()` |
| Unterbrochene Sichtung fortsetzen | `offerSessionResume()` → `applySavedMarks()` |
| Metadaten in JPEG schreiben | `tryWriteKeywordsIntoJpeg()` → `writeKeywordsToJpeg()` |
| Sicherheitsprüfung vor dem Löschen | `verifyMovedFile()` |
| Dateiname bauen | `buildFilename()` |
| Stichwortkatalog | Abschnitt ab `generateCatalogId()` |

### Datenfluss beim Verschieben

```
FileSystemFileHandle
  → getFile()
  → arrayBuffer()
  → writeKeywordsToJpeg()      IPTC-IRB + XMP-APP1 ersetzen,
                               Bilddaten ab Start-of-Scan unangetastet
  → verifyWrittenJpegKeywords()  Round-Trip im Speicher
  → getFileHandle(neuerName, {create:true}) + createWritable()
  → writeXmpSidecar()            zusätzlich immer .xmp daneben
  → verifyMovedFile()            frisch von Platte lesen:
                                 Größe + SHA-256 + Metadaten
  → sourceDir.removeEntry()      erst jetzt, und nur bei Erfolg
```

Diese Kette ist das Herzstück und durchdacht: der irreversible Schritt steht
ganz am Ende und ist durch eine Prüfung abgesichert, die die Datei tatsächlich
neu vom Dateisystem liest statt dem Speicherinhalt zu vertrauen. Die
Schwachstellen lagen nicht im Konzept, sondern in zwei Lücken der Umsetzung
(K1, K2 unten).

Vorgelagert ist inzwischen `planActions()`: der Trockenlauf berechnet denselben
Durchgang mit denselben Funktionen, ohne etwas zu verändern, und zeigt ihn zur
Bestätigung. Nachgelagert sind die Protokolldatei und `undoLastRun()`, das die
Kette in dieselbe Richtung rückwärts durchläuft – schreiben, prüfen, erst danach
löschen.

### Datenhaltung

- **Flüchtig:** `state` (Handles, `photos`, Cursor, Auswahl, Filter,
  Sortierung, Protokoll des letzten Durchgangs).
- **Persistent (localStorage):** `fotoImporter.settings.v1` – Namensschema-
  Voreinstellungen inklusive Zielunterordner-Gliederung, der Schalter für
  Unterordner der Quelle, Stichwortkatalog. Export/Import als JSON-Datei möglich.
- **Persistent (IndexedDB):** `fotoImporter`/`session` – die beiden
  Verzeichnis-Handles und je Foto Pfad, Name, Markierung, Stichworte. Nur dort
  lassen sich Handles aufbewahren; localStorage kann nur Zeichenketten. Die
  Berechtigung wandert nicht mit und muss aus einer Nutzeraktion heraus neu
  erteilt werden.
- **Persistent (Zielverzeichnis):** `foto-importer-protokoll.txt` – was in
  welchem Durchgang wohin verschoben und was gelöscht wurde.
- **Bewusste Entscheidung:** Stichworte hängen als **Text** am Foto, nicht als
  Katalog-ID. Ein zugewiesenes Stichwort überlebt damit das Löschen aus dem
  Katalog. Innerhalb des Katalogs wird dagegen per ID referenziert, damit
  Umbenennen überall durchschlägt. Beides ist richtig so und im Code begründet.

### Build und Deployment

Nicht vorhanden und nicht nötig. Statisch ausliefern oder lokal öffnen. Kein
CI, keine GitHub Actions, keine Konfigurationsdateien.

### Abhängigkeiten

**Keine.** Kein `package.json`, kein Lockfile, keine `node_modules`, keine
CDN-Einbindung, kein externer Request im gesamten HTML. Damit existiert die
gesamte Kategorie „veraltete oder verwundbare Abhängigkeit" hier nicht –
`npm audit` hat kein Ziel. Die Angriffsfläche beschränkt sich auf den eigenen
Code.

Das gilt auch für die Tests: sie laufen mit `node:test`/`node:assert`, also
Bordmitteln. Nur die *automatisierte* Ausführung der Browser-Tests braucht
Playwright – optional, nicht eingecheckt, und ihr Fehlen lässt den Testlauf
nicht scheitern, sondern meldet den Schritt als übersprungen.

### Tests

Das Test-Setup liegt in `tests/` und deckt zwei Ebenen ab (Details in
[`tests/README.md`](tests/README.md)):

| Teil | Was | Umfang |
|---|---|---|
| `tests/*.test.js` | Unit-Tests der Binärformat-Module, `node:test` | 90 Prüfungen |
| `tests/browser.html`, `browser-suite.js` | Anwendungslogik gegen die geladene App | 124 Prüfungen |
| `tests/check-load-order.js` | Top-Level-Code darf nichts aus später Geladenem brauchen | – |
| `tools/sync-help.js --check` | eingebaute Hilfe stimmt mit `HANDBUCH.md` überein | – |
| `tests/run-browser.js` | fährt die Browser-Tests ohne Fenster (Playwright optional) | – |
| `tests/run-all.js` | bündelt alles zur Definition of Done | – |

Die Anwendungsdateien lassen sich in Node nicht laden – sie greifen beim Start
auf `document` zu. Die Browser-Suite wird deshalb in ein iframe mit der geladenen
App injiziert; nur dort sind deren Top-Level-`const`/`let` sichtbar, ohne dass
eine Test-Hintertür eingebaut werden müsste. Die Verzeichnis-Handles sind
Attrappen, sodass `executeActions()` und `undoLastRun()` vollständig durchlaufen,
ohne eine echte Datei anzufassen.

Nicht abgedeckt: das echte Dateisystem, echte Kameradateien (RAW, HEIC,
Hersteller-EXIF) und die Oberfläche. Der manuelle Durchlauf mit Kopien echter
Fotos bleibt deshalb Teil der Definition of Done.

### Zustand beim Prüflauf

Statisch ausgeliefert lädt die App alle zwanzig Skripte fehlerfrei, bootet im
Headless-Chromium **ohne JavaScript-Fehler** und rendert die vollständige
Oberfläche. Die Konsole ist beim Start vollständig leer – auch nach dem Öffnen
von Namensschema-Dialog, Stichwortkatalog und Hilfe; jeder Eintrag dort ist ein
Befund. `node tests/run-all.js` läuft vollständig durch: Syntax-Check,
Dubletten-Prüfung der globalen Namen, Ladereihenfolge, Abgleich der Hilfe mit dem
Handbuch, 90 Unit-Tests, 124 Browser-Tests.

---

## 2. Befunde

Priorisiert nach Auswirkung. **K** = kritisch, **M** = mittel, **G** = gering.

### Kritisch

#### K1 – Bestehende Zieldateien werden ohne Vorwarnung überschrieben

`app.js:3079–3090`, `app.js:2974`

`ensureUniqueName()` prüft Namenskollisionen ausschließlich gegen das
In-Memory-Set `usedTargetNames`. Das Zielverzeichnis selbst wird nie befragt.
Anschließend schreibt `getFileHandle(finalName, { create: true })` +
`createWritable()` die Datei – und `createWritable()` verwirft standardmäßig den
bestehenden Inhalt.

Folge: Existiert im Zielverzeichnis bereits eine Datei desselben Namens, wird sie
**stillschweigend überschrieben**. Das Set ist nach jedem Reload der Seite leer,
schützt also nicht einmal über zwei Durchgänge hinweg.

Realistisches Szenario: Namensschema `Datum_Ereignis` ohne Zähler, zwei
Importe desselben Ereignisses am selben Tag in zwei Sitzungen. Der zweite
Import überschreibt die Fotos des ersten – und löscht anschließend, gedeckt
durch die erfolgreiche Prüfung, auch noch die Quelldateien. Datenverlust ohne
jede Fehlermeldung.

Verschärfend: das Set wird auch beim Wechsel des Zielverzeichnisses nie geleert,
sodass Namen aus Ordner A im Ordner B unnötige `_1`-Suffixe erzeugen.

**Behebung:** vor dem Schreiben mit `getFileHandle(name)` ohne `create` prüfen,
ob die Datei existiert (wirft `NotFoundError`, wenn nicht), und den Namen so
lange hochzählen, bis er im Zielverzeichnis wirklich frei ist. Das Set beim
Wechsel des Zielverzeichnisses leeren. Der Sidecar-Name muss in dieselbe Prüfung
einbezogen werden.

#### K2 – Der dokumentierte Sidecar-Fallback funktioniert nicht

`app.js:2961–3007` im Zusammenspiel mit `app.js:604–609`

Scheitert bei einem JPEG die direkte Metadaten-Einbettung, fällt der Code
bewusst auf die unveränderte Originaldatei zurück und meldet dem Nutzer per
Toast, die Metadaten „liegen als XMP-Sidecar-Datei bei". Anschließend läuft
aber `verifyMovedFile()` – und dessen Schritt 3 prüft für JPEG-Dateien mit
Stichworten die **eingebetteten** Metadaten der Zieldatei. In der Fallback-Datei
sind die naturgemäß nicht vorhanden.

Die Prüfung schlägt also **zwangsläufig** fehl, der Verschiebevorgang bricht mit
„Zieldatei-Prüfung fehlgeschlagen" ab. Zurück bleibt eine verwaiste Zieldatei
plus Sidecar im Zielverzeichnis, während die Quelldatei liegen bleibt und der
Nutzer eine Fehlermeldung sieht, die zur eben gezeigten Erfolgsmeldung im
Widerspruch steht.

Kein Datenverlust – die Sicherheitskette hält –, aber der als sicherer Weg
beworbene Pfad ist unbenutzbar, und der Nutzer wird in die Irre geführt.

**Behebung:** ob Metadaten eingebettet wurden, ist an der Stelle bekannt.
Diesen Umstand an `verifyMovedFile()` durchreichen und die Metadatenprüfung nur
dann verlangen, wenn tatsächlich eingebettet wurde.

#### K3 – Ereignistext wird nicht auf dateinamentaugliche Zeichen geprüft

`app.js:2687–2689`

```js
function sanitizeEventText(text) {
  return text.trim().replace(/\s+/g, "_");
}
```

Ersetzt Leerzeichen und sonst nichts. Der Ereignistext geht direkt in den
Dateinamen ein. Zeichen wie `/ \ : * ? " < > |` bleiben unverändert stehen und
sind auf gängigen Dateisystemen in Namen unzulässig; `getFileHandle()` weist
Namen mit Pfadseparatoren zurück.

Folge: ein Nutzer tippt „Urlaub 2024/25" und **jede einzelne Datei** des
Durchgangs scheitert mit einer technischen Fehlermeldung – ohne Hinweis, dass
der Schrägstrich die Ursache ist. Kein Datenverlust (die Quelldateien bleiben),
aber der Kernablauf der App bricht an einer alltäglichen Eingabe.

Zusätzlich ungeprüft: führende/abschließende Punkte, unter Windows reservierte
Namen (`CON`, `PRN`, `NUL`, `AUX`, `COM1`…), Leerstring nach Bereinigung, sowie
die maximale Namenslänge.

**Behebung:** unzulässige Zeichen in `sanitizeEventText()` ersetzen und die
Live-Vorschau im Ereignis-Dialog auf dem bereinigten Ergebnis aufsetzen, damit
der Nutzer die Umwandlung vor dem Start sieht.

### Mittel

#### M1 – `escapeHtml()` maskiert keine Anführungszeichen, wird aber in Attributen verwendet

`app.js:1779–1783`, verwendet in `app.js:3402` und `app.js:3442`

`escapeHtml()` arbeitet über `textContent` → `innerHTML`. Das maskiert `&`, `<`
und `>`, **nicht aber `"`**. An zwei Stellen landet das Ergebnis in einem
HTML-Attributwert:

```js
<input type="text" value="${escapeHtml(kw.label)}" data-kwid="${kw.id}" …>
```

Ein Stichwort oder Gruppenname mit einem Anführungszeichen bricht damit aus dem
Attribut aus. Harmlose Variante: das Eingabefeld zeigt Unsinn. Ernste Variante:
`" autofocus onfocus="…` injiziert ausführbaren Code.

Der Angriffsweg ist der Einstellungs-Import (`btnImportSettings`), der beliebiges
JSON annimmt und dessen Labels ungeprüft in den Katalog übernimmt. Eine
präparierte Einstellungsdatei führt beim nächsten Öffnen des Stichwortkatalogs
Code aus. Da die App über die File System Access API Schreib- und Löschzugriff
auf zwei Nutzerverzeichnisse hält, ist das keine folgenlose Spielerei.

Einzuordnen ist es dennoch als mittel und nicht kritisch: es braucht eine aktive
Nutzerhandlung mit einer fremden Datei, und die App ist Single-Origin ohne
Netzwerkzugriff.

**Behebung:** `escapeHtml()` um `"` und `'` erweitern (und damit für beide
Kontexte sicher machen). Zusätzlich beim Import validieren, dass Labels und
Namen Strings sind.

#### M2 – Tastenkürzel im Grid ignorieren Modifikatortasten

`app.js:1089–1172`

Der `keydown`-Handler des Grids prüft `ev.ctrlKey`/`ev.metaKey` nur bei `a`
(Alles auswählen). Alle anderen Kürzel greifen unabhängig von
Modifikatortasten – und rufen `preventDefault()` auf:

- `Strg+V` markiert alle ausgewählten Fotos **zum Verschieben**
- `Strg+L` markiert sie **zum Löschen**
- `Strg+1`…`Strg+9` weisen ein Favoriten-Stichwort zu statt den Browser-Tab zu wechseln
- `Strg+X`, `Strg+T`, `Strg+I` ebenso umgedeutet

Besonders unangenehm: der Nutzer wollte etwas einfügen und hat stattdessen
seine Fotoauswahl zum Löschen markiert – bei einer App, die Dateien endgültig
löscht.

**Behebung:** am Anfang des Handlers `if (ev.ctrlKey || ev.metaKey || ev.altKey)`
auf die Fälle einschränken, die das wirklich vorsehen.

#### M3 – Stichworte über 64 Byte lassen den ganzen Verschiebevorgang scheitern

`iptc-iim.js:74` gegen `app.js:436` und `app.js:464`

`buildIptcIimBlock()` kürzt jedes Stichwort spezifikationskonform auf
`MAX_KEYWORD_BYTES` (64). `verifyWrittenJpegKeywords()` vergleicht die
zurückgelesenen Stichworte aber mit den **ungekürzten** Erwartungswerten. Für
die Beschreibung wird dieselbe Kürzung korrekt auf den Erwartungswert
angewendet (`app.js:470–472`) – für Stichworte wurde das vergessen.

Folge: ein Stichwort über 64 UTF-8-Byte lässt den Konsistenz-Check
fehlschlagen, damit die Einbettung, und über K2 anschließend den kompletten
Verschiebevorgang. Die beiden Fehler verstärken sich.

**Behebung:** dieselbe `truncateUtf8()`-Behandlung wie bei der Beschreibung auf
die erwarteten Stichworte anwenden.

#### M4 – EXIF-Datum wird nicht gefunden, wenn XMP vor EXIF steht

`exif.js:21–31`

Die Segmentschleife bricht beim **ersten** APP1-Segment ab und übergibt es an
`parseExifSegment()`. Ist dieses erste APP1 kein EXIF- sondern ein
XMP-Segment – zulässig und bei manchen Werkzeugen üblich –, liefert
`parseExifSegment()` `null`, und `readExifDate()` gibt sofort `null` zurück,
ohne die restlichen Segmente zu durchsuchen.

Folge: das Aufnahmedatum wird stillschweigend durch das Dateiänderungsdatum
ersetzt. Das wirkt sich auf Sortierung **und auf den erzeugten Dateinamen** aus,
also auf das Ergebnis im Archiv. Der Fehler ist unsichtbar – niemand bemerkt ein
falsches, aber plausibles Datum.

**Behebung:** APP1-Segmente ohne `"Exif\0\0"`-Präambel überspringen und weiter
suchen, statt abzubrechen. `EXIF_PREAMBLE` in `jpeg-segments.js` ist dafür
bereits definiert – und aktuell ungenutzt.

#### M5 – Keine Rückfrage vor dem endgültigen Löschen von Fotos

`app.js:2884–2899`, `app.js:3023–3034`

Sind nur Löschungen markiert, startet der Durchgang **ohne jede Rückfrage**.
`removeEntry()` löscht endgültig; die File System Access API kennt keinen
Papierkorb.

Die Gewichtung im Programm ist damit genau verkehrt herum: das Löschen einer
Namensschema-Voreinstellung fragt nach (`app.js:2815`), das Löschen eines
Stichworts aus dem Katalog fragt nach (`app.js:3454`) – das unwiederbringliche
Löschen von 200 Fotos nicht.

**Behebung:** Bestätigungsdialog mit Nennung der Anzahl und dem ausdrücklichen
Hinweis, dass kein Papierkorb beteiligt ist.

#### M6 – Speicherverbrauch wächst über die Sitzung unbegrenzt

`app.js:2110`, `app.js:2137`

`largePreviewUrl` (bis 1600 px) und `fullResUrl` (Lupe) werden pro Foto einmal
erzeugt und dann bis zum Ordnerwechsel gehalten. Freigegeben wird nur in
`revokePhotoObjectUrls()` – also beim Verwerfen der gesamten Liste.

Wer einen Ordner mit einigen hundert Fotos im Leuchttisch durchsieht, sammelt
entsprechend viele große Blobs an. Bei den Zielgrößen dieser App (Kameraordner
mit vierstelligen Fotozahlen) ist das der wahrscheinlichste Weg in einen
zähen oder abstürzenden Tab.

**Behebung:** LRU-Fenster (z. B. die letzten 20 besuchten Fotos behalten, ältere
`largePreviewUrl`/`fullResUrl` freigeben). Die Grid-Thumbnails sind klein genug,
um sie zu behalten.

#### M7 – Fehlgeschlagene Dateien werden über Namens-Präfixe wiedererkannt

`app.js:3044`

```js
const failed = errors.some((msg) => msg.startsWith(entry.name + ":"));
```

Nach dem Durchlauf wird über String-Vergleich auf der Fehlerliste rekonstruiert,
welches Foto gescheitert ist. Ein Dateiname mit `:` oder eine Fehlermeldung, die
zufällig so beginnt, ordnet den Fehler dem falschen Eintrag zu – und ein
fälschlich als erfolgreich eingestuftes Foto verschwindet aus der Liste, obwohl
die Datei noch in der Quelle liegt.

**Behebung:** Ergebnisse während der Schleife pro Eintrag festhalten
(`Map<PhotoEntry, Error>` oder ein Flag am Eintrag) statt sie hinterher aus
Text zu rekonstruieren.

### Gering

- **G1 – Toter Code.** `writeIptcKeywordsToJpeg()` (`jpeg-segments.js:98–162`,
  65 Zeilen) wird nirgends aufgerufen; aktiv ist `writeKeywordsToJpeg()`. Die
  beiden sind sich ähnlich genug, um beim Patchen verwechselt zu werden.
  Ebenfalls ungenutzt: `parseIptcIimKeywords()` (`iptc-iim.js:135`, als
  Kompatibilitäts-Wrapper deklariert) und die Konstante `EXIF_PREAMBLE`
  (`jpeg-segments.js:12`) – letztere würde M4 beheben helfen.
- **G2 – Ungenutzte Variable.** `scanStart` aus der Destrukturierung in
  `writeIptcKeywordsToJpeg()` (`jpeg-segments.js:99`).
- **G3 – Irreführende Funktionsnamen.** `downscaleImageToDataUrl()` und
  `canvasToDataUrl()` liefern **Object-URLs** (`blob:`), keine Data-URLs. Der
  Doc-Kommentar sagt es richtig, der Name das Gegenteil.
- **G4 – Object-URL-Leck im Thumbnail-Fallback.** `app.js:710–712` erzeugt im
  `catch`-Zweig eine Object-URL, ohne vorher `myGeneration` zu prüfen. Wechselt
  der Nutzer währenddessen den Ordner, hängt die URL an einem verworfenen
  Eintrag und wird nie freigegeben.
- **G5 – Feld fehlt bei der Initialisierung.** `loadPhotosFromSource()`
  (`app.js:204–216`) legt `fullResUrl` nicht an, obwohl die Typdefinition es
  führt. Funktioniert nur, weil alle Prüfungen truthy-basiert sind.
- **G6 – Vorzeichenbehaftete Größe.** `parseIrbs()` (`photoshop-irb.js:78`)
  berechnet die Blockgröße per `<<24` und erhält bei sehr großen Werten eine
  negative Zahl. In einem 64-KB-Segment praktisch unerreichbar, aber `>>> 0`
  wäre korrekt.
- **G7 – Ungeprüfte Präfix-Lesevorgänge.** `readAsciiPrefix()`
  (`jpeg-segments.js:57`) liest über das Segmentende hinaus, wenn ein Segment
  kürzer als die erwartete Präambel ist – `buffer[i]` liefert dann `undefined`.
  Fehlerkennung statt Absturz, aber prüfenswert.
- **G8 – Duplizierte Hilfsfunktion.** `readAsciiPrefixLocal()` (`app.js:483`) ist
  eine wortgleiche Kopie von `readAsciiPrefix()`. Bewusst so kommentiert, aber
  bei geteiltem globalem Scope unnötig.
- **G9 – Fehlende Repo-Hygiene.** `README.md` enthält nur die Überschrift, es
  gibt keine `.gitignore` und keine Lizenzdatei. Für ein Projekt mit einem
  ausführlichen `HANDBUCH.md` ist der leere Einstiegspunkt schade.
- **G10 – Kein Favicon.** Erzeugt bei jedem Start einen 404 in der Konsole – der
  einzige Eintrag und damit genau das Rauschen, das echte Fehler verdeckt.
- **G11 – Doppelte Doc-Kommentare.** Über `writeKeywordsToJpeg()`
  (`jpeg-segments.js:164–183`) stehen zwei aufeinanderfolgende JSDoc-Blöcke für
  dieselbe Funktion.
- **G12 – Handbuch doppelt gepflegt.** Die Hilfe-Inhalte existieren zweimal:
  als `HANDBUCH.md` und als `HELP_CHAPTERS`-Array in `app.js`. Sie werden
  auseinanderlaufen.

### Ausdrücklich nicht gefunden

- **Keine hartcodierten Secrets, API-Keys oder Zugangsdaten.** Der Scan über
  alle Quelldateien ist sauber.
- **Keine externen Ressourcen.** Kein CDN, kein Font, kein Tracking-Pixel, kein
  einziger ausgehender Request im gesamten HTML.
- **Keine verwundbaren Abhängigkeiten** – mangels Abhängigkeiten.
- **Keine ungenutzten Dependencies oder verwaisten Dateien.** Alle sieben
  Skripte werden geladen und genutzt.

---

## 3. Verbesserungsvorschläge

Aufwand und Nutzen jeweils niedrig / mittel / hoch.

### Code und Architektur

| # | Vorschlag | Aufwand | Nutzen | Stand |
|---|---|---|---|---|
| V1 | **K1–K3 beheben** (Überschreibschutz, Fallback-Prüfung, Dateinamen-Bereinigung). Alle drei betreffen den Kernablauf; K1 kann Fotos vernichten. | niedrig | **hoch** | ✅ umgesetzt |
| V2 | **Test-Setup für die Binärformat-Module.** Die sechs Module sind DOM-frei und exportieren bereits per `module.exports` – ein `node --test`-Lauf ohne jede Dependency ist realistisch. Round-Trip-Tests (schreiben → zurücklesen), Grenzfälle bei Kürzung, JPEG ohne APP13, JPEG mit vorhandenem IPTC. Das ist der Teil der App, wo ein Fehler Bilddaten beschädigt, und der Teil, der sich am billigsten absichern lässt. | niedrig | **hoch** | ✅ umgesetzt (siehe `tests/`) |
| V3 | **`escapeHtml()` um Anführungszeichen erweitern** und den Einstellungs-Import validieren (M1). Einzeiler plus Prüfschleife. | niedrig | mittel | ✅ umgesetzt |
| V4 | **Modifikatortasten in den Tastaturhandlern prüfen** (M2). | niedrig | mittel | ✅ umgesetzt |
| V5 | **`app.js` aufteilen.** Naheliegende Schnitte entlang der bestehenden Banner: `state.js`, `grid.js`, `lightbox.js`, `keywords.js`, `execute.js`, `help.js`. Ohne Build-Schritt bleibt es bei zusätzlichen `<script>`-Tags – der globale Scope wird dabei nicht schlechter, als er heute schon ist. Erst nach V2 angehen, damit die Umbauten abgesichert sind. | mittel | mittel | ✅ umgesetzt (elf Dateien) |
| V6 | **LRU-Fenster für Großvorschauen** (M6). | niedrig | mittel | ✅ umgesetzt |
| V7 | **Toten Code entfernen** (G1, G2, G11) und die irreführenden Namen korrigieren (G3). | niedrig | niedrig | ✅ umgesetzt |
| V8 | **Ergebnisverfolgung pro Eintrag statt String-Matching** (M7). | niedrig | niedrig | ✅ umgesetzt |
| V9 | **Hilfe aus einer Quelle erzeugen** (G12) – `HELP_CHAPTERS` beim Bauen aus `HANDBUCH.md` ableiten oder umgekehrt. Ohne Build-Schritt am ehesten als kleines Node-Skript, das man bei Bedarf aufruft. | mittel | niedrig | ✅ umgesetzt (`tools/sync-help.js`) |

### Funktionserweiterungen

| # | Vorschlag | Aufwand | Nutzen | Stand |
|---|---|---|---|---|
| F1 | **Rückfrage vor dem Löschen** (M5) – mit Anzahl und dem Hinweis, dass kein Papierkorb beteiligt ist. | niedrig | **hoch** | ✅ umgesetzt |
| F2 | **Trockenlauf / Vorschau des Durchgangs.** Vor dem Start eine Liste zeigen: „diese 47 Dateien werden zu diesen Namen; diese 12 werden gelöscht", inklusive Warnung bei Namenskonflikten im Zielverzeichnis. Macht den unumkehrbaren Schritt überprüfbar. | mittel | **hoch** | ✅ umgesetzt |
| F3 | **Verschieben in Unterordner nach Datum** (`2026/2026-08/`), optional als weiterer Baustein im Namensschema. Der häufigste nächste Wunsch bei genau diesem Werkzeugtyp; `getDirectoryHandle(name, {create:true})` gibt es her. | mittel | **hoch** | ✅ umgesetzt |
| F4 | **Zustand über Reload retten.** Markierungen und zugewiesene Stichworte gehen aktuell bei jedem Reload verloren. Verzeichnis-Handles lassen sich in IndexedDB persistieren und mit `queryPermission()` reaktivieren – eine unterbrochene Sichtung von 800 Fotos wäre damit fortsetzbar. | mittel | **hoch** | ✅ umgesetzt (IndexedDB) |
| F5 | **Rückgängig-Protokoll für den letzten Durchgang.** Verschobene Dateien lassen sich zurückbewegen; für gelöschte geht es nicht – aber schon eine Protokolldatei im Zielverzeichnis („was wurde wohin, was wurde gelöscht") wäre ein Sicherheitsnetz. | mittel | mittel | ✅ umgesetzt |
| F6 | **Unterordner der Quelle einbeziehen** (heute bewusst nur die oberste Ebene), optional per Schalter. | niedrig | mittel | ✅ umgesetzt |
| F7 | **RAW-Vorschau aus eingebettetem JPEG.** RAW-Dateien zeigen heute nur einen grauen Kasten. Die meisten RAW-Formate enthalten ein JPEG-Vorschaubild, das sich mit derselben Segment-Logik herausziehen ließe, die bereits existiert. | hoch | mittel | ✅ umgesetzt (`raw-preview.js`) |
| F8 | **Stichwort-Vorschläge aus vorhandenen Metadaten** – beim Einlesen bereits vorhandene IPTC/XMP-Stichworte anzeigen und übernehmbar machen. Der Lesecode dafür ist vollständig vorhanden. | mittel | mittel | ✅ umgesetzt |
| F9 | **Favicon ergänzen** (G10). | niedrig | niedrig | ✅ umgesetzt |

### Stand

**Alle Vorschläge sind umgesetzt.** Was daraus geworden ist, steht in
Abschnitt 5.

Was dabei neu entstanden ist und selbst wieder Pflege braucht:

- `help-content.js` ist **erzeugt**. Wer dort etwas ändert, verliert es beim
  nächsten `node tools/sync-help.js`. Der Text gehört ins Handbuch.
- Die Aufteilung in elf Dateien hat eine Regel scharf gemacht, die vorher nicht
  existierte (Ladereihenfolge, siehe Abschnitt 1). `tests/check-load-order.js`
  fängt Verstöße ab, aber nur bis zu einer Ebene tief – ein Aufruf über zwei
  Funktionen hinweg bliebe unbemerkt.
- Der Trockenlauf berechnet den Durchgang ein zweites Mal. Das ist gewollt (er
  benutzt dieselben Funktionen), kostet bei sehr vielen Fotos aber Zeit, weil
  jeder Zielname gegen das Dateisystem geprüft wird.
- **Rückgängig** gilt nur für den letzten Durchgang und nur innerhalb derselben
  Sitzung. Es über einen Reload hinweg zu ermöglichen, hieße auch die
  Ziel-Handles zu sichern und wäre der nächste sinnvolle Ausbau – wenn sich
  zeigt, dass er gebraucht wird.

Sinnvoll als Nächstes wäre nichts davon aus eigenem Antrieb, sondern das, was
sich im Gebrauch als störend herausstellt. Der Rückstand ist an dieser Stelle
abgearbeitet.

---

## 4. Behebungsstand

Alle Befunde aus Abschnitt 2 sind behoben. Was jeweils geändert wurde:

### Kritisch

| ID | Änderung |
|---|---|
| K1 | `ensureUniqueName()` ist jetzt `async`, bekommt das Ziel-Handle und prüft über `targetFileExists()` das **Dateisystem** – zusätzlich für den zugehörigen `.xmp`-Namen, damit sich zwei Fotos mit gleichem Basisnamen nicht gegenseitig die Sidecar-Datei überschreiben. `usedTargetNames` wird zu Beginn jedes Durchgangs geleert. |
| K2 | Neues Flag `metadataEmbedded` in `executeActions()`. `verifyMovedFile()` bekommt die erwarteten Metadaten nur, wenn tatsächlich eingebettet wurde – beim Sidecar-Fallback `null`. Damit läuft der Fallback-Pfad durch, statt zwangsläufig abzubrechen. |
| K3 | `sanitizeEventText()` ersetzt unzulässige Zeichen; neu hinzugekommen ist `sanitizeFileBaseName()` als letzte Instanz für den fertigen Namen (führende/abschließende Punkte, Längenbegrenzung, reservierte Windows-Gerätenamen). `buildFilename()` gibt das Ergebnis dadurch. |

### Mittel

| ID | Änderung |
|---|---|
| M1 | `escapeHtml()` maskiert jetzt auch `"` und `'` und ist damit für Attributwerte sicher. Zusätzlich prüfen `normalizeKeywordCatalog()` und das neue `normalizePresets()` importierte Einstellungen auf die erwartete Form und verwerfen alles Übrige – inklusive Verweisen auf nicht vorhandene Stichworte. |
| M2 | Beide Keydown-Handler (Grid und Leuchttisch) steigen bei `ctrlKey`/`metaKey`/`altKey` aus; Strg/Cmd+A wird separat davor behandelt. |
| M3 | `verifyWrittenJpegKeywords()` vergleicht IPTC gegen die auf `MAX_KEYWORD_BYTES` gekürzten Erwartungswerte und XMP gegen die ungekürzten. |
| M4 | `readExifDate()` sucht nach einem APP1 ohne EXIF-Präambel weiter, statt aufzugeben. `parseExifSegment()` prüft den vollständigen `"Exif\0\0"`-Header; eine Längenprüfung verhindert eine Endlosschleife bei beschädigten Segmenten. |
| M5 | `executeActions()` fragt vor dem Löschen mit Anzahl und dem Hinweis nach, dass kein Papierkorb beteiligt ist. |
| M6 | Neuer LRU-Cache (`LARGE_PREVIEW_CACHE_SIZE = 20`) für `largePreviewUrl`/`fullResUrl` mit `touchLargePreview()` / `releaseLargePreviews()`. Das gerade angezeigte Foto ist immer das zuletzt benutzte und kann daher nicht verdrängt werden. |
| M7 | Gescheiterte Fotos werden als Objektreferenz in `failedEntries` festgehalten; die Zählung der Prüfungsfehler läuft über ein Fehler-Flag statt über Textvergleich. |

### Gering

| ID | Änderung |
|---|---|
| G1, G2, G11 | `writeIptcKeywordsToJpeg()` (78 Zeilen), `parseIptcIimKeywords()`, die ungenutzte Konstante `EXIF_PREAMBLE` und ein doppelter JSDoc-Block entfernt. |
| G3 | `downscaleImageToDataUrl` → `downscaleImageToObjectUrl`, `canvasToDataUrl` → `canvasToObjectUrl`. |
| G4 | Der Thumbnail-Fallback prüft die Ladegeneration und gibt eine verwaiste Object-URL frei. |
| G5 | `fullResUrl: null` bei der Initialisierung ergänzt. |
| G6 | Blockgröße in `parseIrbs()` mit `>>> 0` vorzeichenlos gelesen. |
| G7 | `readAsciiPrefix()` prüft die Puffergrenze und liefert `""` statt über das Ende hinaus zu lesen. |
| G8 | `readAsciiPrefixLocal()` in `app.js` entfernt; die Stelle nutzt jetzt `readAsciiPrefix()`. |
| G10 | Favicon als Data-URI eingebettet – die Konsole ist beim Start jetzt vollständig leer. |

**Zusätzlich behoben** (beim Umsetzen aufgefallen): Die Kommentare behaupteten,
die XMP-Sidecar-Datei sei „bereits beim Schreiben verifiziert" worden – das war
nicht der Fall. Für alle Formate ohne Direkteinbettung ist sie die einzige
Ablage der Metadaten. Neu ist deshalb `verifySidecarFile()`, das die Datei vor
dem Löschen der Quelle frisch zurückliest und vergleicht.

**G9 (Repo-Hygiene)** ist nachgeholt: `README.md` beschreibt Zweck,
Voraussetzungen, Start, Sicherheitskonzept und Tests; eine `.gitignore` hält
`node_modules/` und Editor-/Systemdateien draußen.

Die **Lizenzdatei entfällt bewusst** – der Urheber hat sich gegen eine Lizenz
entschieden. Damit gilt das volle Urheberrecht („alle Rechte vorbehalten"), auch
wenn das Repository öffentlich einsehbar ist. Kein offener Punkt, sondern eine
getroffene Entscheidung: nicht ungefragt eine Lizenz nachtragen.

**G12 (doppelt gepflegtes Handbuch)** blieb zunächst offen – ein Prozessthema,
kein Fehlverhalten des Programms – und ist mit V9 erledigt: `HANDBUCH.md` ist
jetzt die einzige Quelle, `help-content.js` wird daraus erzeugt und der Abgleich
ist Teil von `run-all.js`. Punkt 5 der Definition of Done fängt das damit nicht
mehr per Disziplin auf, sondern strukturell.

### Verifikation

Jeder Befund oben ist durch mindestens einen Test im Repository abgedeckt – die
Prüfung liegt also nicht mehr außerhalb, sondern läuft bei jedem
`node tests/run-all.js` mit:

| Befund | Wo geprüft |
|---|---|
| K1 Überschreibschutz | `browser-suite.js`, Bereich „Überschreibschutz" – belegte Zieldatei, zwei gleichnamige Ziele im selben Durchgang, fremde Sidecar-Datei |
| K2 Sidecar-Fallback | Bereich „Sidecar-Fallback" – Einbettung wird erzwungen zum Scheitern gebracht |
| K3 Dateinamen | Bereich „Dateinamen" und „Ereignistext" – Schrägstrich im Ereignistext |
| M1 Escaping/Import | Bereich „Escaping" (Ausbruch aus einem Attributwert) und „Import-Härtung" |
| M3 lange Stichworte | Bereich „Lange Stichworte" sowie `iptc-iim.test.js` / `xmp-packet.test.js` |
| M4 EXIF hinter XMP | `exif.test.js` |
| M5 Löschabfrage | Bereich „Löschabfrage", inklusive Gegenprobe ohne Löschungen |
| M6 Vorschau-Cache | Bereich „Vorschau-Cache" |
| M7 Fehlerzuordnung | Bereich „Fehlerzuordnung" – zwei Dateien, deren Namen einander als Präfix enthalten |
| G6, G7 | `photoshop-irb.test.js`, `jpeg-segments.test.js` |

Dazu kommen die Zusicherungen, die nicht aus einem Befund stammen, sondern das
Sicherheitskonzept selbst absichern: die Bilddaten ab Start-of-Scan bleiben beim
Schreiben von Metadaten byteidentisch, die Zieldatei bleibt ein decodierbares
Bild, mehrfaches Schreiben lässt die Datei nicht wachsen – und die Gegenproben:
eine verfälschte Zieldatei und eine verfälschte Sidecar-Datei müssen das Löschen
der Quelle **verhindern**.

Dass die Tests tatsächlich greifen, wurde per Mutationsprobe gegengeprüft: mit
wieder eingebautem M4-Fehler schlägt genau der zugehörige Test fehl, die
übrigen bleiben grün.

**Was weiterhin von Hand gehört:** ein Durchlauf mit Kopien echter Fotos. Die
Tests ersetzen die File System Access API durch Attrappen – das prüft die Logik,
nicht das Zusammenspiel mit dem echten Dateisystem. Und der echte Pfad löscht
endgültig.

---

## 5. Umsetzung der Vorschläge

Alle Vorschläge aus Abschnitt 3 sind umgesetzt. Was jeweils entstanden ist – und
die Entscheidung dahinter, wo sie nicht offensichtlich ist:

### Funktionserweiterungen

| # | Was daraus geworden ist |
|---|---|
| **F2** Trockenlauf | Ein Dialog vor jedem Durchgang mit Quellname → Zielordner/Zielname je Datei, der Löschliste und Warnungen (endgültiges Löschen, belegte Namen, neue Ordner). Berechnet mit `planActions()` – **denselben** Funktionen wie die Ausführung. Eine zweite, näherungsweise Berechnung wäre genau dort falsch, wo man die Vorschau braucht. Der Trockenlauf legt nichts an: Zielordner werden nur aufgelöst (`resolveExistingDirectory`), nicht erzeugt. |
| **F3** Zielunterordner | Fünf benannte Gliederungen (Jahr bis Jahr/Monat/Tag, Ereignis, Jahr/Ereignis) im Namensschema-Dialog, mit Live-Beispiel. Maßgeblich ist das Aufnahmedatum des Fotos. Bewusst eine feste Auswahl statt eines zweiten Baukastens – eine Archivstruktur trifft man einmal. |
| **F4** Zustand über Reload | `session-store.js` sichert Handles und Markierungen in IndexedDB; beim Start bietet ein Balken das Fortsetzen an. Nicht automatisch: ein wiederhergestellter Handle hat keine Berechtigung, und die lässt sich nur aus einer Nutzeraktion heraus erneuern. Das Quellverzeichnis wird frisch eingelesen; verschwundene Fotos werden gemeldet, nicht auf andere Dateien übertragen. |
| **F5** Protokoll und Rückgängig | Eine fortgeschriebene `foto-importer-protokoll.txt` im Zielverzeichnis, plus `undoLastRun()` für den letzten Durchgang derselben Sitzung. Das Zurückbewegen folgt derselben Reihenfolge wie das Verschieben – schreiben, prüfen, erst danach löschen; schlägt die Prüfung fehl, existiert die Datei lieber zweimal als keinmal. Gelöschte Dateien sind ausdrücklich nicht erfasst. |
| **F6** Unterordner der Quelle | Schalter in der Toolbar, rekursives Einlesen mit Tiefenbegrenzung, versteckte Ordner ausgenommen. Der Kern der Änderung ist unscheinbar: jeder `PhotoEntry` merkt sich jetzt den Ordner, in dem er **liegt** – `removeEntry()` auf dem Quellverzeichnis hätte die Datei im Unterordner stehen lassen, nachdem sie bereits kopiert war. |
| **F7** RAW-Vorschau | `raw-preview.js` findet das eingebettete Vorschau-JPEG über die TIFF-Struktur (CR2, NEF, ARW, DNG, ORF, SRW, RW2), den festen RAF-Kopf oder ersatzweise eine Suche nach JPEG-Marken. Das Modul liefert nur Byte-Bereiche; dadurch genügt für die Analyse der Dateianfang und das Bild wird als schmaler Ausschnitt nachgeladen, statt 30–60 MB pro Kachel zu lesen. Entschieden wird per `createImageBitmap` – ein plausibler Bereich muss noch kein Bild sein. |
| **F8** Vorhandene Stichworte | Beim Einlesen werden IPTC/XMP-Stichworte mitgelesen (dieselbe Leseoperation wie fürs Aufnahmedatum) und zur Übernahme angeboten. Nicht automatisch zugewiesen: was in der Datei steht, ist eine Aussage des vorherigen Programms. XMP hat Vorrang vor IPTC, weil IPTC auf 64 Byte kürzt. |

### Code und Architektur

| # | Was daraus geworden ist |
|---|---|
| **V5** Aufteilung | Elf Anwendungsdateien, geschnitten exakt an den vorhandenen Banner-Grenzen und in der ursprünglichen Reihenfolge – die Ausführungsreihenfolge beim Laden bleibt Zeile für Zeile dieselbe. Genau ein Fall musste umziehen (`loadPresetIntoBuilder`), und der wäre nicht beim Entwickeln aufgefallen, sondern nur bei Nutzern mit gespeicherter Voreinstellung. Deshalb prüft `tests/check-load-order.js` das jetzt dauerhaft. |
| **V9/G12** Hilfe | `HANDBUCH.md` ist die einzige Quelle; `tools/sync-help.js` erzeugt daraus `help-content.js`, und `run-all.js` schlägt fehl, wenn beide auseinander sind. Punkt 5 der Definition of Done war der Versuch, das per Disziplin aufzufangen – jetzt kann es strukturell nicht mehr passieren. Der Markdown-Übersetzer im Skript kann genau das, was das Handbuch verwendet; ein vollständiger wäre eine Abhängigkeit. |

### Was das mit dem Testnetz gemacht hat

| | vorher | nachher |
|---|---:|---:|
| Unit-Prüfungen | 67 | 90 |
| Browser-Prüfungen | 55 | 124 |
| Prüfschritte in `run-all.js` | 4 | 6 |

Neu unter den Prüfungen sind unter anderem: der Trockenlauf legt nichts an,
schreibt nichts und löscht nichts; ein misslungenes Zurückschreiben lässt die
Zieldatei stehen; gleiche Dateinamen in verschiedenen Unterordnern kollidieren
weder bei der Namensvergabe noch beim Wiederherstellen einer Sitzung; die
Tastenkürzel-Tabelle kommt in der erzeugten Hilfe tatsächlich an.

Die Prüfung der Ladereihenfolge wurde per Mutationsprobe gegengeprüft: mit einem
absichtlich zu früh gesetzten Aufruf schlägt sie fehl, danach wieder nicht.

**Unverändert offen bleibt** der Durchlauf mit Kopien echter Fotos. Die Tests
arbeiten mit Attrappen der File System Access API; Berechtigungsdialoge, echte
Kameradateien und das Verhalten auf Netzlaufwerken oder vollen Datenträgern sind
damit nicht abgedeckt. Für den Verschiebe- und den neuen Rückgängig-Pfad ist das
kein formaler Rest, sondern die entscheidende Prüfung – beide löschen endgültig.
