# Foto-Importer

Ein Werkzeug für den Schritt zwischen Speicherkarte und Fotoarchiv: Fotos
sichten, pro Bild „verschieben" oder „löschen" markieren, verschlagworten und
den Stapel dann in ein Zielverzeichnis übernehmen – umbenannt nach einem frei
konfigurierbaren Namensschema und mit den Stichworten als IPTC/XMP-Metadaten in
der Datei.

**Alles läuft lokal im Browser.** Kein Server, kein Netzwerkverkehr, keine
Telemetrie, keine Registrierung. Die Fotos verlassen den Rechner nicht.

## Voraussetzungen

Ein **Chromium-Browser auf dem Desktop** – Chrome oder Edge. Die Anwendung
braucht die File System Access API zum Schreiben; Firefox und Safari
unterstützen sie nicht.

## Starten

Es gibt keine Installation und keinen Build-Schritt. Ein Doppelklick auf
`index.html` genügt allerdings nicht zuverlässig, weil `file://` einige der
benötigten Browser-Schnittstellen einschränkt. Stattdessen:

```bash
python3 -m http.server 8000
```

Dann `http://localhost:8000/index.html` in Chrome oder Edge öffnen.

Wer die Anwendung dauerhaft bereitstellen will, legt die Dateien auf einen
beliebigen Static-Host – mehr ist nicht nötig.

## Bedienung

Das vollständige Benutzerhandbuch steht in **[HANDBUCH.md](HANDBUCH.md)**;
dieselben Inhalte sind in der Anwendung über <kbd>F1</kbd> durchsuchbar.

Der übliche Ablauf in Kürze:

1. **Quellverzeichnis öffnen** (Speicherkarte, externe Platte)
2. Fotos im Grid oder im Leuchttisch sichten – Pfeiltasten zum Navigieren,
   <kbd>V</kbd> zum Verschieben vormerken, <kbd>L</kbd> zum Löschen,
   <kbd>X</kbd> hebt auf
3. Stichworte vergeben (<kbd>T</kbd> oder Favoriten auf <kbd>1</kbd>–<kbd>9</kbd>)
4. **Zielverzeichnis wählen** und **Aktionen ausführen**

## Sicherheit beim Verschieben

Verschieben heißt kopieren, prüfen und erst dann die Quelle löschen – in genau
dieser Reihenfolge. Vor dem Löschen liest die Anwendung die geschriebene
Zieldatei **frisch vom Dateisystem** zurück und vergleicht Größe, die
SHA-256-Prüfsumme der Bilddaten und die geschriebenen Metadaten. Schlägt eine
dieser Prüfungen fehl, bleibt die Quelldatei unangetastet.

Eine vorhandene Datei im Zielverzeichnis wird nie überschrieben; die Anwendung
weicht auf einen freien Namen aus.

Zum **Löschen** dagegen: die File System Access API kennt keinen Papierkorb.
Gelöschte Dateien sind endgültig weg. Die Anwendung fragt deshalb vorher nach.

## Unterstützte Formate

Angezeigt und verarbeitet werden JPEG, PNG, GIF, BMP, WebP, HEIC/HEIF sowie die
RAW-Formate CR2, NEF, ARW, DNG, RAF, ORF, RW2 und SRW.

Stichworte werden bei **JPEG** direkt in die Datei eingebettet (IPTC-IIM und
XMP), ohne EXIF, ICC-Profil oder die Bilddaten selbst zu verändern. Für **alle**
Formate wird zusätzlich eine XMP-Sidecar-Datei neben dem Foto abgelegt.

## Tests

```bash
node tests/run-all.js
```

Führt Syntax-Prüfung, Unit-Tests der Binärformat-Module und die Browser-Tests
der Anwendungslogik aus. Details und die Einzelbefehle stehen in
**[tests/README.md](tests/README.md)**.

## Für Entwickler

- **[CLAUDE.md](CLAUDE.md)** – Architektur, Konventionen, Definition of Done
- **[ANALYSIS.md](ANALYSIS.md)** – Befundliste, Behebungsstand, offene Vorschläge
- **[tests/README.md](tests/README.md)** – Aufbau des Test-Setups

Der Technik-Stand in einem Satz: Vanilla JavaScript, kein Framework, keine
Abhängigkeiten, kein Build-Schritt. Sieben Skripte werden per `<script src>`
geladen, das CSS liegt inline in der `index.html`.
