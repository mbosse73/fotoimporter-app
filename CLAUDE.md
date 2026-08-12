# CLAUDE.md

Hinweise für Claude Code zur Arbeit in diesem Repository.

## Was ist das Projekt?

**Foto-Importer** – eine rein clientseitige Browser-Anwendung zum Importieren,
Sichten, Organisieren und Verschlagworten von Fotos. Typischer Ablauf: Fotos von
einer Speicherkarte / externen Platte sichten, pro Foto „Verschieben" oder
„Löschen" markieren, Stichworte vergeben und den Stapel dann in ein
Zielverzeichnis verschieben – dabei werden die Dateien nach einem frei
konfigurierbaren Namensschema umbenannt und die Stichworte als IPTC/XMP-Metadaten
in die Datei geschrieben.

Alles läuft **lokal im Browser**. Es gibt keinen Server, keinen Netzwerkverkehr
und keine Telemetrie. Die Nutzeroberfläche ist durchgehend **deutsch**.

## Tech-Stack

- **Vanilla JavaScript (ES2020+), kein Framework, keine Build-Tools.**
- Kein `package.json`, keine `node_modules`, keine Dependencies – weder Laufzeit
  noch Entwicklung. Bewusste Entscheidung: die App ist so einfach durch Öffnen
  der `index.html` lauffähig.
- Alle Skripte werden per `<script src>` als **klassische Skripte im globalen
  Scope** geladen (keine ES-Module, kein `import`/`export`). Die Ladereihenfolge
  in `index.html` ist relevant: erst die Format-/Hilfsmodule, dann die
  Anwendungsdateien in fester Reihenfolge. Sie wird von
  `tests/check-load-order.js` geprüft – siehe „Ladereihenfolge" unten.
- Browser-APIs, zusätzlich zum Kern: **IndexedDB** (Verzeichnis-Handles über
  einen Reload retten, siehe `session-store.js`).
- CSS liegt vollständig **inline im `<style>`-Block von `index.html`**.
- Browser-APIs, die den Kern tragen: **File System Access API**
  (`showDirectoryPicker`), `IntersectionObserver`, `createImageBitmap`,
  `canvas.toBlob`, `crypto.subtle` (SHA-256), `localStorage`.
- **Läuft nur in Chromium-Browsern** (Chrome/Edge Desktop) – Firefox und Safari
  unterstützen die File System Access API zum Schreiben nicht.

## Dateien

**Gerüst und Format-Module** (werden zuerst geladen):

| Datei | Zeilen | Rolle |
|---|---:|---|
| `index.html` | ~1110 | Komplettes DOM-Gerüst + gesamtes CSS + Script-Tags |
| `exif.js` | ~145 | Minimaler EXIF-Parser, liest nur das Aufnahmedatum |
| `exif-extended.js` | ~290 | Erweiterte EXIF-Daten (Kamera, Belichtung, GPS, Maße) fürs Info-Overlay |
| `jpeg-segments.js` | ~225 | JPEG-Segment-Parser/-Writer (APP13/APP1 ersetzen, Bilddaten unangetastet) |
| `iptc-iim.js` | ~140 | IPTC-IIM-Kodierung/-Dekodierung (Keywords 2:25, Caption 2:120) |
| `photoshop-irb.js` | ~105 | Photoshop Image Resource Blocks („8BIM"), Container für IPTC in JPEG |
| `xmp-packet.js` | ~105 | XMP-RDF/XML erzeugen und zurücklesen (`dc:subject`, `dc:description`) |
| `raw-preview.js` | ~305 | Findet das eingebettete Vorschau-JPEG in RAW-Dateien (TIFF-Varianten, RAF) |
| `session-store.js` | ~115 | IndexedDB-Zugriff für den Sitzungszustand |
| `help-content.js` | ~230 | **Erzeugt** aus `HANDBUCH.md` (`node tools/sync-help.js`) – nicht von Hand ändern |

**Anwendungsdateien**, in genau dieser Ladereihenfolge:

| Datei | Zeilen | Rolle |
|---|---:|---|
| `state.js` | ~305 | Konstanten, `state`, `PhotoEntry`, dauerhafte Einstellungen, Toasts |
| `source.js` | ~315 | Quellverzeichnis öffnen, Fotos einlesen (auch rekursiv), Sortierung |
| `metadata.js` | ~340 | Stichworte schreiben/lesen, Verifikation der Zieldatei |
| `thumbnails.js` | ~295 | Lazy Loading, LRU-Cache der Großvorschauen, RAW-Vorschau |
| `grid.js` | ~680 | Filterung, Grid-Rendering, Tastaturnavigation, Quick Look |
| `keywords.js` | ~470 | Stichwortzuweisung, Zuweisungspanel, Statusleiste |
| `lightbox.js` | ~870 | Leuchttisch, EXIF-Overlay, Lupe, Seitenpanel, Filmstreifen |
| `naming.js` | ~415 | Namensschema, Zielunterordner, Voreinstellungen, Export/Import |
| `execute.js` | ~1015 | Trockenlauf, Durchgang, Sitzungssicherung, Protokoll, Rückgängig |
| `catalog.js` | ~545 | Stichwortkatalog (Pool, Gruppen, Sets, Favoriten) |
| `overlays.js` | ~270 | Fortschritt, Hilfe, Shortcut-Leisten, Initialisierung |

**Dokumentation und Werkzeuge:**

| Datei | Rolle |
|---|---|
| `HANDBUCH.md` | Benutzerhandbuch (deutsch) – **einzige Quelle** auch für die Hilfe in der App |
| `ANALYSIS.md` | Architektur-, Fehler- und Verbesserungsanalyse |
| `tools/sync-help.js` | Erzeugt `help-content.js` aus `HANDBUCH.md` |
| `tests/` | Test-Setup, siehe [`tests/README.md`](tests/README.md) |

Jede Anwendungsdatei ist zusätzlich durch Banner-Kommentare
(`/* ==== ABSCHNITT ==== */`) gegliedert – der schnellste Weg zur Orientierung ist
`grep -n '^/\* =\{10,\}' *.js` gefolgt von der Zeile darunter.

### Ladereihenfolge

Der Punkt, an dem die Aufteilung beißt: **Funktionsdeklarationen werden nur
innerhalb ihrer eigenen Datei nach oben gezogen.** Solange alles in einer Datei
stand, konnte Top-Level-Code jede Funktion aufrufen. Jetzt sieht er nur, was
zuvor geladen wurde.

Der gefährliche Fall ist nicht der offensichtliche Aufruf – der scheitert beim
ersten Start. Gefährlich ist ein Aufruf in einem Zweig, den nur manche Nutzer
nehmen: `applyDefaultFormatIfNone()` greift auf `loadPresetIntoBuilder()` nur zu,
wenn tatsächlich eine Voreinstellung gespeichert ist. Deshalb steht diese
Funktion in `state.js` und nicht bei ihrem Dialog in `naming.js`.

`node tests/check-load-order.js` prüft das (und läuft in `run-all.js` mit). Wer
einen Befund bekommt, hat zwei Möglichkeiten: die Funktion in eine früher
geladene Datei verschieben, oder den Aufruf in die Initialisierung in
`overlays.js` verlegen.

## Starten

Ein Doppelklick auf `index.html` genügt nicht zuverlässig (`file://` schränkt
einige APIs ein). Stattdessen einen statischen Server nutzen:

```bash
python3 -m http.server 8000
# dann http://localhost:8000/index.html in Chrome/Edge öffnen
```

Es gibt **keinen Build-Schritt, keine Installation, kein Deployment-Skript**.
Deployment = die Dateien auf einen beliebigen Static-Host legen (oder lokal
öffnen).

## Tests

```bash
node tests/run-all.js
```

Ein Befehl für alles Automatisierbare: Syntax-Check, Dubletten-Prüfung der
globalen Namen, Ladereihenfolge, Abgleich der Hilfe mit `HANDBUCH.md`,
Unit-Tests, Browser-Tests. Exit-Code 0 heißt bestanden.
Details in [`tests/README.md`](tests/README.md).

Zwei Ebenen, weil der Code auf zwei Ebenen lebt:

- **`tests/*.test.js`** – `node:test`/`node:assert`, keine Abhängigkeiten. Die
  Binärformat-Module exportieren am Dateiende per `module.exports` und lassen
  sich direkt per `require()` laden.
- **`tests/browser.html` + `browser-suite.js`** – für die Anwendungsdateien, die
  sich in Node nicht laden lassen (Zugriff auf `document` beim Start). Die Suite
  wird in ein iframe mit der geladenen App injiziert und sieht dadurch deren
  Top-Level-`const`/`let`. Die Verzeichnis-Handles sind Attrappen, sodass
  `executeActions()` vollständig durchläuft, ohne eine echte Datei anzufassen.

`node tests/run-browser.js` fährt die Browser-Tests ohne Fenster – braucht
Playwright, das nur bei Bedarf lokal installiert wird (`--no-save`, steht in
`.gitignore`) und **keine** Projekt-Abhängigkeit ist. Fehlt es, wird der Schritt
übersprungen statt zu scheitern.

**Was die Tests nicht abdecken:** das echte Dateisystem, echte Kameradateien und
die Oberfläche. Der manuelle Durchlauf bleibt deshalb Teil der Definition of Done.

## Datenmodell

**`state`** (in `state.js`) hält den Sitzungszustand: Verzeichnis-Handles, das
`photos`-Array, Cursor, Mehrfachauswahl, aktiver Filter, Sortierung, Schalter für
Unterordner, Protokoll des letzten Durchgangs. Er lebt im Speicher; was davon
einen Reload überlebt, steht unten unter „IndexedDB".

**`PhotoEntry`** (JSDoc-Typdef am Kopf von `state.js`) ist der zentrale Datensatz
pro Foto: Dateiname, `FileSystemFileHandle`, Endung, Vorschau-URLs in drei
Auflösungsstufen (`thumbUrl` / `largePreviewUrl` / `fullResUrl`, alle lazy),
Aufnahme- und Dateidatum, Größe, `action` (`'none'|'move'|'delete'`),
`assignedKeywords` – sowie `dirHandle`/`relPath` (der Ordner, in dem die Datei
tatsächlich liegt) und `existingKeywords` (was schon in der Datei stand).

**`appSettings`** (in `localStorage` unter `fotoImporter.settings.v1`):
Namensschema-Voreinstellungen (inklusive Zielunterordner-Gliederung), der
Schalter für Unterordner der Quelle und der Stichwortkatalog (globaler
Keyword-Pool + Gruppen + Sets + 9 Favoriten-Slots).

**IndexedDB** (`fotoImporter`, Store `session`, siehe `session-store.js`) hält
den unterbrochenen Sichtungsstand: die beiden Verzeichnis-Handles und je Foto
Pfad, Name, Markierung, Stichworte. Nur dort lassen sich Handles aufbewahren –
localStorage kann nur Zeichenketten. Ein wiederhergestellter Handle bringt seine
Berechtigung nicht mit; sie muss aus einer Nutzeraktion heraus neu erteilt
werden. Deshalb der Balken über dem Grid statt stiller Wiederherstellung.

Wichtige, bewusste Design-Entscheidung: **Stichworte werden am Foto als Text
gespeichert, nicht als Katalog-ID.** Ein einmal zugewiesenes Stichwort bleibt
damit erhalten, auch wenn es später aus dem Katalog gelöscht wird. Katalog-IDs
gelten nur innerhalb des Katalogs (Gruppen/Sets/Favoriten referenzieren per ID,
damit Umbenennen überall durchschlägt).

## Konventionen

- **Sprache:** Bezeichner englisch, Kommentare und alle nutzersichtbaren Texte
  deutsch. Beibehalten.
- **Kommentare erklären das Warum,** nicht das Was – oft mehrzeilig über einer
  Funktion, mit der Begründung für eine nicht offensichtliche Entscheidung. Beim
  Ändern solcher Stellen den Kommentar mitpflegen, sonst wird er zur Falle.
- `"use strict"` steht am Kopf **jeder** Anwendungsdatei.
- Rendering-Funktionen heißen `renderX()`, Zustands-Anwendung `applyX()` /
  `updateX()`, Dialoge `openX()` / `closeX()`.
- **Globaler Namensraum:** Alle Dateien teilen sich einen Scope. Ein neuer
  Top-Level-`const` mit einem Namen, den es schon gibt, bricht die ganze App beim
  Laden. Vor dem Anlegen neuer globaler Namen prüfen:
  `grep -hoE '^(function|const|let|var) [A-Za-z0-9_$]+' *.js | awk '{print $2}' | sort | uniq -d`
- **Escaping:** Nutzereingaben, die per Template-String in `innerHTML` landen,
  laufen durch `escapeHtml()`. **Achtung:** `escapeHtml()` maskiert **keine
  Anführungszeichen** und ist damit für Attributwerte ungeeignet – siehe
  `ANALYSIS.md`, Befund M1.
- **Object-URLs:** Jede mit `URL.createObjectURL()` erzeugte URL gehört an einen
  `PhotoEntry` und wird über `revokePhotoObjectUrls()` freigegeben. Neue
  URL-Felder dort mit eintragen, sonst leckt Speicher.

## Sicherheitskonzept beim Verschieben (nicht abschwächen)

Die Reihenfolge in `executeActions()` ist bewusst so und schützt vor Datenverlust:

1. Metadaten in eine **Kopie im Speicher** schreiben und sofort per
   Round-Trip zurücklesen (`verifyWrittenJpegKeywords`).
2. Kopie ins Zielverzeichnis schreiben, zusätzlich immer eine XMP-Sidecar-Datei.
3. Zieldatei **frisch vom Dateisystem** neu einlesen und prüfen: Größe,
   SHA-256 der Bilddaten (bei JPEG ab Start-of-Scan, der garantiert unverändert
   bleibt), eingebettete Metadaten (`verifyMovedFile`).
4. **Erst danach** die Quelldatei löschen. Schlägt Schritt 3 fehl, bleibt die
   Quelle unangetastet.

Wer hier etwas ändert, muss diese Kette erhalten. Löschungen über
`removeEntry()` sind **endgültig** – die File System Access API kennt keinen
Papierkorb.

## Definition of Done

Vor jedem Commit:

1. **`node tests/run-all.js` läuft durch.** Deckt Syntax-Check, doppelte globale
   Namen, Ladereihenfolge, Abgleich der Hilfe mit dem Handbuch, Unit-Tests und
   Browser-Tests ab.
2. **Neue Tests für neues Verhalten.** Eine Korrektur ohne Test, der den Fehler
   vorher zeigt, ist nicht fertig – sonst kehrt er zurück.
3. **Smoke-Test im Browser:** App über `python3 -m http.server` laden und
   sicherstellen, dass die Konsole beim Start **fehlerfrei** ist. Sie ist
   vollständig leer; jeder Eintrag ist ein Befund.
4. **Manueller Durchlauf des betroffenen Pfades.** Für Änderungen am
   Verschiebe-/Metadaten-Pfad ist das nicht optional, und **immer mit Kopien
   echter Fotos in einem Wegwerf-Ordner** – der Pfad löscht Dateien endgültig.
   Die Tests ersetzen das nicht: sie arbeiten mit Attrappen statt mit dem echten
   Dateisystem. Mindestens: ein JPEG mit Stichworten verschieben, danach prüfen,
   dass die Zieldatei existiert, das Bild unbeschädigt ist, die `.xmp`-Sidecar
   daneben liegt und die Quelldatei verschwunden ist.
5. **Handbuch mitziehen:** Ändert sich Verhalten, Tastenkürzel oder eine
   Beschriftung, gehört das in `HANDBUCH.md` – und danach
   `node tools/sync-help.js`, damit die eingebaute Hilfe folgt. `help-content.js`
   wird **nicht von Hand** bearbeitet; `run-all.js` schlägt fehl, wenn beide
   auseinander sind.

## Backup und Rollback

Vor größeren Umbauten einen Tag auf dem letzten funktionierenden Stand setzen:

```bash
git tag -a stand-vor-<thema> -m "funktionierender Stand vor <thema>"
git push origin stand-vor-<thema>
```

Rollback dann per `git revert <commit>` (bevorzugt, Historie bleibt erhalten)
oder `git checkout stand-vor-<thema> -- <datei>` für einzelne Dateien. Auf
`main` nie force-pushen. Jede inhaltliche Änderung läuft über einen
`claude/<thema>`-Branch, nicht direkt auf `main`.

## Bekannte Besonderheiten und Fallstricke

- **Ladereihenfolge ist scharf.** Funktionsdeklarationen werden nur innerhalb
  ihrer eigenen Datei hochgezogen. Was beim Laden läuft, darf nichts aus einer
  später geladenen Datei brauchen – auch nicht in einem selten genommenen Zweig.
  `node tests/check-load-order.js` prüft das, siehe oben.
- **Markierungen überleben einen Reload, aber nur mit Zustimmung.** Der
  gesicherte Stand liegt in IndexedDB und wird über den Balken angeboten. Beim
  Testen daran denken: ein alter Stand kann eine neue Sitzung überlagern, wenn
  man den Balken übersieht.
- **`help-content.js` ist erzeugt.** Änderungen dort gehen beim nächsten
  `node tools/sync-help.js` verloren. Der Text gehört in `HANDBUCH.md`.
- **Zielnamen werden gegen das Dateisystem geprüft, nicht nur gegen den
  Speicher.** `ensureUniqueName()` ist deshalb `async` und braucht das
  Ziel-Handle. Diese Prüfung ist der einzige Schutz davor, eine vorhandene Datei
  zu überschreiben und danach die Quelle zu löschen – nicht wegoptimieren.
- **`metadataEmbedded` entscheidet über die Metadaten-Prüfung.** Wurde auf die
  Sidecar-Variante zurückgefallen, dürfen in der Zieldatei keine eingebetteten
  Metadaten erwartet werden. `verifyMovedFile()` mit `null` statt der Stichworte
  aufrufen, sonst schlägt der Fallback-Pfad zwangsläufig fehl.
- **IPTC kürzt Stichworte auf 64 Byte, XMP nicht.** Wer den Round-Trip-Vergleich
  anfasst, muss beide Erwartungswerte getrennt halten
  (`expectedIptcKeywords` vs. `validExpected`).
- **Tastenkürzel sind reine Einzeltasten.** Beide Keydown-Handler steigen bei
  `ctrlKey`/`metaKey`/`altKey` aus (Ausnahme: Strg/Cmd+A). Neue Kürzel dahinter
  einsortieren, sonst kapern sie Browser-Shortcuts.
- **Große Vorschauen liegen in einem LRU-Cache** (`LARGE_PREVIEW_CACHE_SIZE`).
  Wer `largePreviewUrl`/`fullResUrl` liest, ruft `touchLargePreview(entry)` auf –
  sonst kann die gerade angezeigte Vorschau verdrängt werden.
- **`escapeHtml()` maskiert auch Anführungszeichen** und ist damit für Attribute
  geeignet. Diese Eigenschaft nicht wieder entfernen – zwei Aufrufstellen
  (`renderContainerDetail`, `renderKeywordChips`) verlassen sich darauf.
- **Importierte Einstellungen sind Fremddaten.** `normalizeSettings()` ist die
  eine Stelle für Laden UND Import; `normalizeKeywordCatalog()` und
  `normalizePresets()` verwerfen alles, was nicht die erwartete Form hat. Neue
  Felder dort mit aufnehmen. Dasselbe gilt für den gesicherten Sitzungsstand:
  `applySavedMarks()` prüft jede Markierung, statt ihr zu glauben.
- **Der Trockenlauf darf nichts anlegen.** `planActions()` löst Zielordner nur
  auf (`resolveExistingDirectory`), erzeugt sie nicht, und benutzt einen eigenen
  Reservierungstopf für Namen. Wer dort `resolveTargetDirectory()` einsetzt,
  hinterlässt bei jedem Abbruch leere Ordner.
- **Vergebene Zielnamen sind pro Ordner geschlüsselt.** `usedTargetNames` enthält
  `"2026/2026-08|foto.jpg"`, nicht `"foto.jpg"`. Ein gemeinsamer Topf erzeugte in
  jedem weiteren Unterordner überflüssige `_1`-Suffixe.
- **Gelöscht wird über `entry.dirHandle`, nicht über `state.sourceDirHandle`.**
  Beim Einlesen mit Unterordnern sind das verschiedene Ordner; sonst bliebe die
  bereits kopierte Quelldatei liegen.
