# Analyse: Foto-Importer

Ergebnis eines Repo-Onboardings vom 11.08.2026 auf Commit `3128f35`. Rein
analytisch – am Code wurde für dieses Dokument nichts geändert.

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

Eine **monolithische, klassische Web-Seite ohne Build-Schritt**. Kein Framework,
keine Dependencies, kein Bundler, kein Transpiler, kein Server. Sieben
JavaScript-Dateien werden per `<script src>` in den globalen Scope geladen, das
gesamte CSS liegt inline in der `index.html`.

Das ist für diese App eine tragfähige Entscheidung und kein Versäumnis: sie soll
lokal und offline über die File System Access API auf echten Fotos arbeiten, und
je weniger zwischen Quelltext und Ausführung steht, desto überprüfbarer ist, was
tatsächlich mit den Dateien passiert.

Erkauft wird das mit zwei Kosten: `app.js` ist mit ~4060 Zeilen deutlich zu groß
für eine Datei, und der geteilte globale Scope macht jeden neuen Top-Level-Namen
zu einem potenziellen Kollisionsrisiko.

### Schichtung

Faktisch gibt es zwei sauber getrennte Schichten:

**Unten – Binärformat-Module** (`exif.js`, `exif-extended.js`,
`jpeg-segments.js`, `iptc-iim.js`, `photoshop-irb.js`, `xmp-packet.js`). Reine,
DOM-freie Funktionen, die auf `Uint8Array` arbeiten. Alle exportieren am
Dateiende per `module.exports` und wären ohne jede Änderung in Node
testbar. Diese Schicht ist der qualitativ stärkste Teil des Projekts: die
Formatbehandlung ist spezifikationsnah, kommentiert und defensiv.

**Oben – `app.js`.** Enthält alles Übrige: State, sämtliches Rendering,
Tastatursteuerung, Dialoge, Katalogverwaltung, Dateioperationen. Intern durch
Banner-Kommentare in ~25 Abschnitte gegliedert, was das Zurechtfinden trotz der
Länge gut trägt.

### Zentrale Einstiegspunkte

| Was | Wo |
|---|---|
| Quellordner öffnen und Fotos einlesen | `loadPhotosFromSource()` |
| Gridansicht aufbauen | `renderGrid()` |
| Thumbnail-Lazy-Loading | `pumpThumbQueue()` / `loadOneThumbnail()` |
| Aktionen ausführen (Kern der App) | `executeActions()` |
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
Schwachstellen liegen nicht im Konzept, sondern in zwei Lücken der Umsetzung
(K1, K2 unten).

### Datenhaltung

- **Flüchtig:** `state` (Handles, `photos`, Cursor, Auswahl, Filter,
  Sortierung). Ein Reload verwirft alles.
- **Persistent:** `localStorage["fotoImporter.settings.v1"]` – Namensschema-
  Voreinstellungen und Stichwortkatalog. Export/Import als JSON-Datei möglich.
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

### Zustand beim Prüflauf

Statisch ausgeliefert lädt die App alle sieben Skripte fehlerfrei, bootet im
Headless-Chromium **ohne JavaScript-Fehler** und rendert die vollständige
Oberfläche. `node --check` läuft für alle sieben Dateien sauber durch. Einziger
Konsoleneintrag ist ein 404 für `favicon.ico`.

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

| # | Vorschlag | Aufwand | Nutzen |
|---|---|---|---|
| V1 | **K1–K3 beheben** (Überschreibschutz, Fallback-Prüfung, Dateinamen-Bereinigung). Alle drei betreffen den Kernablauf; K1 kann Fotos vernichten. | niedrig | **hoch** |
| V2 | **Test-Setup für die Binärformat-Module.** Die sechs Module sind DOM-frei und exportieren bereits per `module.exports` – ein `node --test`-Lauf ohne jede Dependency ist realistisch. Round-Trip-Tests (schreiben → zurücklesen), Grenzfälle bei Kürzung, JPEG ohne APP13, JPEG mit vorhandenem IPTC. Das ist der Teil der App, wo ein Fehler Bilddaten beschädigt, und der Teil, der sich am billigsten absichern lässt. | niedrig | **hoch** |
| V3 | **`escapeHtml()` um Anführungszeichen erweitern** und den Einstellungs-Import validieren (M1). Einzeiler plus Prüfschleife. | niedrig | mittel |
| V4 | **Modifikatortasten in den Tastaturhandlern prüfen** (M2). | niedrig | mittel |
| V5 | **`app.js` aufteilen.** Naheliegende Schnitte entlang der bestehenden Banner: `state.js`, `grid.js`, `lightbox.js`, `keywords.js`, `execute.js`, `help.js`. Ohne Build-Schritt bleibt es bei zusätzlichen `<script>`-Tags – der globale Scope wird dabei nicht schlechter, als er heute schon ist. Erst nach V2 angehen, damit die Umbauten abgesichert sind. | mittel | mittel |
| V6 | **LRU-Fenster für Großvorschauen** (M6). | niedrig | mittel |
| V7 | **Toten Code entfernen** (G1, G2, G11) und die irreführenden Namen korrigieren (G3). | niedrig | niedrig |
| V8 | **Ergebnisverfolgung pro Eintrag statt String-Matching** (M7). | niedrig | niedrig |
| V9 | **Hilfe aus einer Quelle erzeugen** (G12) – `HELP_CHAPTERS` beim Bauen aus `HANDBUCH.md` ableiten oder umgekehrt. Ohne Build-Schritt am ehesten als kleines Node-Skript, das man bei Bedarf aufruft. | mittel | niedrig |

### Funktionserweiterungen

| # | Vorschlag | Aufwand | Nutzen |
|---|---|---|---|
| F1 | **Rückfrage vor dem Löschen** (M5) – mit Anzahl und dem Hinweis, dass kein Papierkorb beteiligt ist. | niedrig | **hoch** |
| F2 | **Trockenlauf / Vorschau des Durchgangs.** Vor dem Start eine Liste zeigen: „diese 47 Dateien werden zu diesen Namen; diese 12 werden gelöscht", inklusive Warnung bei Namenskonflikten im Zielverzeichnis. Adressiert K1 aus Nutzersicht und macht den unumkehrbaren Schritt überprüfbar. | mittel | **hoch** |
| F3 | **Verschieben in Unterordner nach Datum** (`2026/2026-08/`), optional als weiterer Baustein im Namensschema. Der häufigste nächste Wunsch bei genau diesem Werkzeugtyp; `getDirectoryHandle(name, {create:true})` gibt es her. | mittel | **hoch** |
| F4 | **Zustand über Reload retten.** Markierungen und zugewiesene Stichworte gehen aktuell bei jedem Reload verloren. Verzeichnis-Handles lassen sich in IndexedDB persistieren und mit `queryPermission()` reaktivieren – eine unterbrochene Sichtung von 800 Fotos wäre damit fortsetzbar. | mittel | **hoch** |
| F5 | **Rückgängig-Protokoll für den letzten Durchgang.** Verschobene Dateien lassen sich zurückbewegen; für gelöschte geht es nicht – aber schon eine Protokolldatei im Zielverzeichnis („was wurde wohin, was wurde gelöscht") wäre ein Sicherheitsnetz. | mittel | mittel |
| F6 | **Unterordner der Quelle einbeziehen** (heute bewusst nur die oberste Ebene), optional per Schalter. | niedrig | mittel |
| F7 | **RAW-Vorschau aus eingebettetem JPEG.** RAW-Dateien zeigen heute nur einen grauen Kasten. Die meisten RAW-Formate enthalten ein JPEG-Vorschaubild, das sich mit derselben Segment-Logik herausziehen ließe, die bereits existiert. | hoch | mittel |
| F8 | **Stichwort-Vorschläge aus vorhandenen Metadaten** – beim Einlesen bereits vorhandene IPTC/XMP-Stichworte anzeigen und übernehmbar machen. Der Lesecode dafür ist vollständig vorhanden. | mittel | mittel |
| F9 | **Favicon ergänzen** (G10). | niedrig | niedrig |

### Empfohlene Reihenfolge

1. **V1 + F1** – die Datenverlust-Pfade zuerst.
2. **V2** – Testnetz, bevor größer umgebaut wird.
3. **V3, V4, V6, V8** – kleine, klar abgegrenzte Korrekturen.
4. **F2** – macht den unumkehrbaren Schritt für den Nutzer überprüfbar.
5. **V5** – Aufteilung erst auf abgesichertem Stand.
6. Alles Weitere nach Bedarf.
