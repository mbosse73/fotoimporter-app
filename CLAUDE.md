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
| `HANDBUCH.md` | ~205 | Benutzerhandbuch (deutsch) |
| `ANALYSIS.md` | – | Architektur-, Fehler- und Verbesserungsanalyse |

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

**Es sind aktuell keine Tests vorhanden** – kein Test-Runner, keine Testdateien,
keine CI. Die Prüf-Schritte, die stattdessen gelten, stehen unter
[Definition of Done](#definition-of-done).

Bemerkenswert: alle Hilfsmodule enden mit `if (typeof module !== "undefined")
module.exports = { … }`. Sie sind damit **bereits ohne Änderung in Node
testbar** – ein Test-Setup könnte sie direkt per `require()` laden.

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

Es gibt keine automatisierten Tests, deshalb gilt vor jedem Commit:

1. **Syntax-Check aller Skripte** (fängt den häufigsten Fehler – Tippfehler in
   einer 4000-Zeilen-Datei ohne Compiler):
   ```bash
   for f in *.js; do node --check "$f" || echo "FEHLER in $f"; done
   ```
2. **Keine doppelten globalen Namen** (siehe Konventionen oben).
3. **Smoke-Test im Browser:** App über `python3 -m http.server` laden und
   sicherstellen, dass die Konsole beim Start **fehlerfrei** ist (ein 404 für
   `favicon.ico` ist normal und der einzige erwartete Eintrag).
4. **Manueller Durchlauf des betroffenen Pfades.** Für Änderungen am
   Verschiebe-/Metadaten-Pfad ist das nicht optional, und **immer mit Kopien
   echter Fotos in einem Wegwerf-Ordner** – der Pfad löscht Dateien endgültig.
   Mindestens: ein JPEG mit Stichworten verschieben, danach prüfen, dass die
   Zieldatei existiert, das Bild unbeschädigt ist, die `.xmp`-Sidecar daneben
   liegt und die Quelldatei verschwunden ist.
5. **Handbuch mitziehen:** Ändert sich Verhalten, Tastenkürzel oder eine
   Beschriftung, müssen `HANDBUCH.md` **und** die `HELP_CHAPTERS` in `app.js`
   (ab ca. Zeile 3760) angepasst werden – die beiden sind inhaltlich
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

- **`usedTargetNames` prüft nicht das Dateisystem.** Das Set für eindeutige
  Zielnamen lebt nur im Speicher und wird nie geleert – bestehende Dateien im
  Zielverzeichnis können dadurch überschrieben werden. Kritischster offener
  Befund, Details in `ANALYSIS.md` (K1).
- **Der dokumentierte „Sidecar-Fallback" greift nicht.** Wenn die direkte
  JPEG-Einbettung scheitert, schlägt die anschließende Zieldatei-Prüfung
  zwangsläufig fehl und die Datei wird gar nicht verschoben (`ANALYSIS.md`, K2).
- **`sanitizeEventText()` ersetzt nur Leerzeichen.** Zeichen wie `/`, `:` oder
  `?` im Ereignistext landen unverändert im Dateinamen und lassen den ganzen
  Verschiebe-Durchgang scheitern (`ANALYSIS.md`, K3).
- **Grid-Shortcuts ignorieren Modifikatortasten.** `Strg+V` markiert Fotos zum
  Verschieben, `Strg+L` zum Löschen (`ANALYSIS.md`, M2).
- **`writeIptcKeywordsToJpeg()` in `jpeg-segments.js` ist toter Code** – der
  aktive Pfad ist `writeKeywordsToJpeg()`. Nicht versehentlich den falschen
  patchen.
- **Vorschaubilder werden nie freigegeben,** solange der Ordner offen bleibt.
  Bei vielen im Leuchttisch besuchten Fotos wächst der Speicherverbrauch stetig.
- **Der Zustand ist flüchtig.** Alle Markierungen und zugewiesenen Stichworte
  sind nach einem Reload weg. Beim Testen daran denken.
