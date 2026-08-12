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
  Scope** geladen (keine ES-Module, kein `import`/`export`). Ladereihenfolge in
  `index.html` ist relevant: Hilfsmodule zuerst, `app.js` zuletzt.
- CSS liegt vollständig **inline im `<style>`-Block von `index.html`**.
- Browser-APIs, die den Kern tragen: **File System Access API**
  (`showDirectoryPicker`), `IntersectionObserver`, `createImageBitmap`,
  `canvas.toBlob`, `crypto.subtle` (SHA-256), `localStorage`.
- **Läuft nur in Chromium-Browsern** (Chrome/Edge Desktop) – Firefox und Safari
  unterstützen die File System Access API zum Schreiben nicht.

## Dateien

| Datei | Zeilen | Rolle |
|---|---:|---|
| `index.html` | ~1000 | Komplettes DOM-Gerüst + gesamtes CSS + Script-Tags |
| `app.js` | ~4060 | Gesamte Anwendungslogik (State, UI, Rendering, Dateioperationen) |
| `exif.js` | ~130 | Minimaler EXIF-Parser, liest nur das Aufnahmedatum |
| `exif-extended.js` | ~290 | Erweiterte EXIF-Daten (Kamera, Belichtung, GPS, Maße) fürs Info-Overlay |
| `jpeg-segments.js` | ~315 | JPEG-Segment-Parser/-Writer (APP13/APP1 ersetzen, Bilddaten unangetastet) |
| `iptc-iim.js` | ~150 | IPTC-IIM-Kodierung/-Dekodierung (Keywords 2:25, Caption 2:120) |
| `photoshop-irb.js` | ~100 | Photoshop Image Resource Blocks („8BIM"), Container für IPTC in JPEG |
| `xmp-packet.js` | ~105 | XMP-RDF/XML erzeugen und zurücklesen (`dc:subject`, `dc:description`) |
| `HANDBUCH.md` | ~210 | Benutzerhandbuch (deutsch) |
| `ANALYSIS.md` | – | Architektur-, Fehler- und Verbesserungsanalyse |
| `tests/` | – | Test-Setup, siehe [`tests/README.md`](tests/README.md) |

`app.js` ist nicht modularisiert, aber konsequent durch Banner-Kommentare
(`/* ==== ABSCHNITT ==== */`) in thematische Abschnitte gegliedert – der schnellste
Weg zur Orientierung ist `grep -n '^/\* =\{10,\}' app.js` gefolgt von der Zeile
darunter.

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
globalen Namen, Unit-Tests, Browser-Tests. Exit-Code 0 heißt bestanden.
Details in [`tests/README.md`](tests/README.md).

Zwei Ebenen, weil der Code auf zwei Ebenen lebt:

- **`tests/*.test.js`** – `node:test`/`node:assert`, keine Abhängigkeiten. Die
  Binärformat-Module exportieren am Dateiende per `module.exports` und lassen
  sich direkt per `require()` laden.
- **`tests/browser.html` + `browser-suite.js`** – für `app.js`, das sich in Node
  nicht laden lässt (Zugriff auf `document` beim Start). Die Suite wird in ein
  iframe mit der geladenen App injiziert und sieht dadurch deren
  Top-Level-`const`/`let`. Die Verzeichnis-Handles sind Attrappen, sodass
  `executeActions()` vollständig durchläuft, ohne eine echte Datei anzufassen.

`node tests/run-browser.js` fährt die Browser-Tests ohne Fenster – braucht
Playwright, das nur bei Bedarf lokal installiert wird (`--no-save`, steht in
`.gitignore`) und **keine** Projekt-Abhängigkeit ist. Fehlt es, wird der Schritt
übersprungen statt zu scheitern.

**Was die Tests nicht abdecken:** das echte Dateisystem, echte Kameradateien und
die Oberfläche. Der manuelle Durchlauf bleibt deshalb Teil der Definition of Done.

## Datenmodell

**`state`** (in `app.js`, nicht persistent) hält den Sitzungszustand:
Verzeichnis-Handles, das `photos`-Array, Cursor, Mehrfachauswahl, aktiver Filter,
Sortierung. Ein Neuladen der Seite verwirft ihn komplett.

**`PhotoEntry`** (JSDoc-Typdef am Kopf von `app.js`) ist der zentrale Datensatz
pro Foto: Dateiname, `FileSystemFileHandle`, Endung, Vorschau-URLs in drei
Auflösungsstufen (`thumbUrl` / `largePreviewUrl` / `fullResUrl`, alle lazy),
Aufnahme- und Dateidatum, Größe, `action` (`'none'|'move'|'delete'`) und
`assignedKeywords`.

**`appSettings`** (in `localStorage` unter `fotoImporter.settings.v1`) ist das
Einzige, was einen Neustart überlebt: Namensschema-Voreinstellungen und der
Stichwortkatalog (globaler Keyword-Pool + Gruppen + Sets + 9 Favoriten-Slots).

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
- `"use strict"` steht am Kopf von `app.js`.
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
   Namen, Unit-Tests und Browser-Tests ab.
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
   Beschriftung, müssen `HANDBUCH.md` **und** die `HELP_CHAPTERS` in `app.js`
   (ab ca. Zeile 4100) angepasst werden – die beiden sind inhaltlich
   deckungsgleich gehalten und laufen sonst auseinander.

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

- **Der Zustand ist flüchtig.** Alle Markierungen und zugewiesenen Stichworte
  sind nach einem Reload weg. Beim Testen daran denken.
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
- **Importierte Einstellungen sind Fremddaten.** `normalizeKeywordCatalog()` und
  `normalizePresets()` verwerfen alles, was nicht die erwartete Form hat. Neue
  Felder dort mit aufnehmen.
