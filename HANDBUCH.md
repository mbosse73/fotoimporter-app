# Foto-Importer – Handbuch

Ein browserbasiertes Programm zum Importieren, Organisieren und Verschlagworten von Fotos von einem externen Laufwerk in ein Zielverzeichnis. Läuft vollständig lokal im Browser (Chrome/Edge) über die File System Access API – es werden keine Daten an einen Server übertragen.

## Inhaltsverzeichnis

1. [Voraussetzungen](#voraussetzungen)
2. [Erste Schritte](#erste-schritte)
3. [Die Gridansicht](#die-gridansicht)
4. [Aktionen: Verschieben und Löschen](#aktionen-verschieben-und-löschen)
5. [Sortierung und Filterung](#sortierung-und-filterung)
6. [Der Stichwortkatalog](#der-stichwortkatalog)
7. [Stichworte zuweisen](#stichworte-zuweisen)
8. [Der Leuchttisch](#der-leuchttisch)
9. [Bildinformationen (EXIF)](#bildinformationen-exif)
10. [Ganzes Foto anzeigen (Quick Look)](#ganzes-foto-anzeigen-quick-look)
11. [Die Lupe](#die-lupe)
12. [Namensschema beim Verschieben](#namensschema-beim-verschieben)
13. [Metadaten in den Dateien (IPTC/XMP)](#metadaten-in-den-dateien-iptcxmp)
14. [Sicherheit beim Verschieben](#sicherheit-beim-verschieben)
15. [Programmeinstellungen: Export/Import](#programmeinstellungen-exportimport)
16. [Alle Tastenkürzel im Überblick](#alle-tastenkürzel-im-überblick)

---

## Voraussetzungen

Foto-Importer benötigt einen Chromium-basierten Browser (**Chrome** oder **Edge**, Desktop). Die zugrundeliegende File System Access API, die direkten Lese-/Schreibzugriff auf lokale Ordner ermöglicht, ist in Firefox und Safari nicht verfügbar. Öffnet man das Programm in einem nicht unterstützten Browser, erscheint beim Start ein entsprechender Hinweis.

Es ist keine Installation nötig – `index.html` wird direkt im Browser geöffnet.

## Erste Schritte

1. **Quellverzeichnis öffnen**: Button „📂 Quellverzeichnis öffnen“ in der Toolbar. Der Browser fragt einmalig nach Zugriffsrechten für den gewählten Ordner.
2. **Zielverzeichnis wählen**: Button „🎯 Zielverzeichnis wählen“ – wird erst benötigt, wenn tatsächlich Fotos verschoben werden sollen.
3. Alle unterstützten Bildformate im Quellordner werden als Vorschau-Kacheln im Grid angezeigt, sortiert nach Aufnahmedatum (änderbar, siehe [Sortierung](#sortierung-und-filterung)).

Es werden nur Dateien **direkt im gewählten Ordner** gelesen, keine Unterordner.

Der Programmzustand wird **nicht** über einen Seitenneustart hinweg gespeichert (mit Ausnahme des Stichwortkatalogs und der Namensschema-Voreinstellungen, siehe unten) – nach einem Neuladen der Seite muss der Ordner erneut geöffnet werden.

## Die Gridansicht

Jede Kachel zeigt eine Bildvorschau, den Dateinamen sowie optische Hinweise auf:

- **Zugewiesene Aktion**: farbiger Rahmen und Beschriftung (grün = Verschieben, rot = Löschen)
- **Zugewiesene Stichworte**: kleine Chips am unteren Rand der Kachel (bis zu 3 sichtbar, „+N“ bei mehr) sowie ein 🏷-Symbol
- **Aktueller Cursor**: gelb hervorgehobener Rahmen
- **Mehrfachauswahl**: blau hervorgehobene Kacheln

Navigation erfolgt mit den **Pfeiltasten**. `Shift`+Pfeiltaste erweitert die Auswahl über einen Bereich. Mit der Maus: Klick wählt aus, `Strg`/`Cmd`+Klick fügt einzelne Kacheln zur Auswahl hinzu, `Shift`+Klick wählt einen Bereich.

## Aktionen: Verschieben und Löschen

Jedem Foto kann eine von drei Aktionen zugewiesen werden:

- **Verschieben** (`V`) – wird beim Ausführen ins Zielverzeichnis verschoben (siehe [Namensschema](#namensschema-beim-verschieben))
- **Löschen** (`L`) – wird beim Ausführen aus dem Quellverzeichnis entfernt
- **Keine Aktion** (`X`) – hebt eine zuvor gesetzte Aktion wieder auf

Diese Tasten wirken auf das aktuell angesteuerte Foto oder, falls eine Mehrfachauswahl aktiv ist, auf alle ausgewählten Fotos gleichzeitig.

Der Button „**Aktionen ausführen ▶**“ oben rechts führt alle gesetzten Aktionen aus. Ist mindestens ein Foto zum Verschieben markiert, fragt das Programm zuvor nach einer Ereignisbeschreibung (siehe [Namensschema](#namensschema-beim-verschieben)).

Ist mindestens ein Foto zum **Löschen** markiert, erscheint zusätzlich eine Sicherheitsabfrage mit der Anzahl der betroffenen Fotos. Gelöschte Dateien landen **nicht im Papierkorb** und lassen sich nicht wiederherstellen.

Die Tastenkürzel wirken nur als einzelne Tasten. `Strg`/`Cmd` in Kombination (z. B. `Strg`+`V` zum Einfügen) bleibt dem Browser überlassen und löst keine Aktion im Programm aus – einzige Ausnahme ist `Strg`/`Cmd`+`A` für „alles auswählen“.

## Sortierung und Filterung

**Sortierung** (Toolbar): Dropdown mit vier Kriterien – Dateiname (natürliche Sortierung, d. h. `IMG_2` vor `IMG_10`), Dateidatum, Aufnahmedatum (EXIF mit Fallback auf Dateidatum) und Dateigröße. Der Button daneben kehrt die Richtung um (↑/↓). Der Cursor bleibt beim Umsortieren auf demselben Foto, nicht auf derselben Position.

**Filterung** (Toolbar): sechs Filter-Buttons, jeweils nur einer aktiv gleichzeitig, nicht kombinierbar:

- Alle
- Nur zum Verschieben markierte
- Nur zum Löschen markierte
- Nur unmarkierte
- Nur Fotos **mit** Stichworten
- Nur Fotos **ohne** Stichworte

Der Leuchttisch respektiert beim Blättern denselben Filter und dieselbe Sortierung wie das Grid.

## Der Stichwortkatalog

Über „🏷️ Stichwortkatalog…“ in der Toolbar erreichbar. Drei Bereiche:

- **Gruppen** – thematisch zusammengehörende Stichworte (z. B. „Landschaft“: Strand, Wald, Meer)
- **Sets** – ereignisbezogene Bündel (z. B. „Hochzeit“: Kleid, Braut, Feier)
- **⭐ Favoriten** – neun Slots für Schnellzugriff per Zifferntaste

Stichworte gehören zu einem gemeinsamen Pool: dasselbe Stichwort kann gleichzeitig in mehreren Gruppen und Sets vorkommen. Wird es umbenannt, ändert sich das überall; wird es aus einem einzelnen Bereich entfernt, bleibt es im Pool und in anderen Bereichen erhalten. Nur die komplette Löschung (🗑-Symbol) entfernt es überall, auch aus belegten Favoriten-Slots.

Favoriten können entweder aus dem Katalog gewählt oder als komplett freier Text eingegeben werden.

Export/Import des Katalogs als eigenständige `.json`-Datei über die Buttons im Dialog-Footer.

## Stichworte zuweisen

Im Grid: Taste `T` öffnet ein Zuweisungs-Panel mit Favoriten (anklickbar), Gruppen/Sets (als Toggle-Chips – ein Klick weist alle enthaltenen Stichworte zu, ein erneuter Klick entfernt sie wieder komplett) sowie einer durchsuchbaren Liste aller Katalog-Stichworte. Wirkt auf das aktuelle Foto oder die Mehrfachauswahl.

Zusätzlich lassen sich die neun Favoriten direkt per Zifferntaste `1`–`9` zuweisen bzw. per erneutem Druck wieder entfernen (Toggle).

Bei einer Mehrfachauswahl mit gemischtem Zustand (manche Fotos haben das Stichwort bereits, andere nicht) wird beim Toggle immer **ergänzt**, nie entfernt – ein versehentliches Löschen bestehender Zuweisungen wird so vermieden. Nur wenn wirklich *alle* ausgewählten Fotos ein Stichwort bereits tragen, entfernt ein erneuter Toggle es bei allen.

Im Leuchttisch steht dieselbe Zuweisungsfunktion über ein Seitenpanel zur Verfügung (siehe unten).

## Der Leuchttisch

`Enter` öffnet den Leuchttisch für das aktuell angesteuerte Foto. Er zeigt das Foto möglichst groß, mit:

- **Filmstreifen** unten: Vorschaubilder benachbarter Fotos zum direkten Anspringen, mit denselben Aktions-/Stichwort-Indikatoren wie im Grid
- **Seitenpanel** (Taste `T` oder Button „🏷️ Panel“, ein-/ausblendbar): identische Stichwort-Zuweisung wie im Grid-Panel, plus die Aktions-Buttons
- **Stichwort-Chips** direkt über dem Bild, auch bei ausgeblendetem Panel sichtbar

Zugewiesene Stichworte und Aktionen sind zwischen Grid und Leuchttisch in Echtzeit synchron – eine Änderung an einer Stelle erscheint sofort auch an der anderen.

`Pfeil links/rechts` blättert innerhalb der aktuellen Sortierung/Filterung. `Escape` schließt den Leuchttisch (bzw. zunächst offene Overlays, siehe [Tastenkürzel](#alle-tastenkürzel-im-überblick)).

## Bildinformationen (EXIF)

Taste `I` blendet ein Info-Panel mit Kamera, Belichtungsdaten (Zeit, Blende, ISO, Brennweite), Blitz, Weißabgleich, GPS-Koordinaten (falls vorhanden), Aufnahmedatum, Bildabmessungen und Dateigröße ein.

- **Im Leuchttisch**: erscheint dezent oben rechts über dem Bild, aktualisiert sich automatisch beim Blättern.
- **Im Grid**: nur verfügbar, wenn **genau ein** Foto ausgewählt ist. Erscheint direkt neben der Kachel (weicht bei Platzmangel automatisch zur anderen Seite aus).

`Escape` schließt das Panel.

## Ganzes Foto anzeigen (Quick Look)

Im Grid öffnet die **Leertaste** bei genau einem angesteuerten Foto eine schnelle, bildschirmfüllende Vorschau ohne weitere Bedienelemente – vergleichbar mit macOS Quick Look. `Escape` oder Klick auf den Hintergrund schließt sie wieder.

Ist eine Mehrfachauswahl aktiv, hat die Leertaste stattdessen ihre andere Funktion: sie schaltet das aktuell angesteuerte Foto in der Auswahl an oder aus.

## Die Lupe

Nur im Leuchttisch: Taste `M` blendet eine runde Lupe ein, die dem Mauszeiger folgt und einen 2,5-fach vergrößerten Bildausschnitt zeigt. Für die Lupe wird bei Bedarf eine möglichst hochauflösende Version des Fotos geladen, damit auch feine Details erkennbar sind. `Escape` schließt die Lupe zuerst, bevor ein zweites `Escape` den Leuchttisch verlässt.

## Namensschema beim Verschieben

Über „⚙️ Namensschema…“ lässt sich der Ziel-Dateiname aus Bausteinen zusammensetzen, per Drag & Drop in beliebiger Reihenfolge:

- **Datum** (JJJJMMTT, Aufnahmedatum)
- **Ereignis** (die beim Verschieben abgefragte Beschreibung, Leerzeichen werden zu Unterstrichen, in Dateinamen unzulässige Zeichen wie `/ \ : * ? " < > |` zu Bindestrichen)
- **Zähler** (Startwert und Stellenzahl einstellbar)
- **Freitext** (fest hinterlegter Text)
- **Trenner** (Unterstrich oder Bindestrich)

Schemata lassen sich als benannte Voreinstellung speichern und später wieder laden.

Beim Ausführen der Verschieben-Aktion (sofern mindestens ein Foto markiert ist) fragt das Programm nach einer Ereignisbeschreibung, die sowohl in den Dateinamen einfließt als auch – unverändert, mit Leerzeichen statt Unterstrichen – als Beschreibung in die Metadaten der Datei geschrieben wird.

## Metadaten in den Dateien (IPTC/XMP)

Beim Verschieben werden zugewiesene Stichworte und die Ereignisbeschreibung nach Möglichkeit standardkonform in die Dateien geschrieben, damit andere Programme sie später zuverlässig wiederfinden können:

- **JPEG**: Stichworte werden als IPTC-IIM-Datensätze (Application Record, Keywords) sowie als XMP `dc:subject` direkt in die Datei eingebettet. Die Beschreibung entsprechend als IPTC Caption/Abstract und XMP `dc:description`. Alle übrigen Metadaten (EXIF, ICC-Profil) und die Bilddaten selbst bleiben dabei unverändert.
- **Alle Formate** (JPEG zusätzlich, alle anderen ausschließlich): eine **XMP-Sidecar-Datei** (`dateiname.xmp`) wird neben dem Foto abgelegt.

Schlägt das direkte Schreiben in eine JPEG-Datei aus irgendeinem Grund fehl oder liefert die Prüfung ein unerwartetes Ergebnis, greift automatisch der sichere Rückfall auf die unveränderte Originaldatei plus Sidecar – es wird nie eine unvollständig beschriebene Datei verwendet.

## Sicherheit beim Verschieben

Es wird **nie eine vorhandene Datei im Zielverzeichnis überschrieben**. Vor dem Schreiben prüft das Programm, ob der geplante Name dort (oder als zugehörige `.xmp`-Datei) bereits vergeben ist, und weicht andernfalls auf `name_1`, `name_2` usw. aus. Das gilt auch über mehrere Durchgänge und Programmstarts hinweg.

Nach dem Schreiben der Zieldatei prüft das Programm aktiv, **bevor** die Quelldatei gelöscht wird:

1. **Größe** der neu geschriebenen Zieldatei
2. **Prüfsumme der Bilddaten** (SHA-256) – bei JPEG wird nur der garantiert unveränderte Bildanteil verglichen, bei anderen Formaten die komplette Datei
3. **Metadaten** (Stichworte/Beschreibung), sofern sie in die Datei eingebettet wurden
4. **XMP-Sidecar-Datei**, sofern eine geschrieben wurde – sie wird ebenfalls zurückgelesen und verglichen, denn für Formate ohne Direkteinbettung ist sie die einzige Ablage der Metadaten

Schlägt eine dieser Prüfungen fehl, wird die Quelldatei **nicht gelöscht**, das Foto bleibt im Grid sichtbar (mit zurückgesetzter Aktion), und eine Meldung weist auf die betroffene Datei hin. Die möglicherweise unvollständige Zieldatei wird bewusst nicht automatisch entfernt, damit sie manuell geprüft werden kann.

## Programmeinstellungen: Export/Import

Über „🛠️ Einstellungen…“ lassen sich alle Programmeinstellungen (Namensschema-Voreinstellungen, Stichwortkatalog) als Sicherung exportieren und auf einem anderen Rechner oder nach einem Neuladen wieder importieren.

## Alle Tastenkürzel im Überblick

### Gridansicht

| Taste | Wirkung |
|---|---|
| `↑` `↓` `←` `→` | Zwischen Fotos navigieren |
| `Shift` + Pfeiltaste | Auswahlbereich erweitern |
| `V` | Markierte Fotos zum Verschieben vormerken |
| `L` | Markierte Fotos zum Löschen vormerken |
| `X` | Aktion aufheben |
| `1`–`9` | Favorit-Stichwort zuweisen/entfernen |
| `T` | Stichwort-Zuweisungspanel öffnen |
| `I` | Bildinformationen anzeigen (nur bei genau einem ausgewählten Foto) |
| `Leertaste` | Ganzes Foto anzeigen (Einzelauswahl) / Auswahl umschalten (Mehrfachauswahl) |
| `Strg`/`Cmd` + `A` | Alle sichtbaren Fotos auswählen |
| `Enter` | Leuchttisch öffnen |
| `Escape` | Offenes Overlay (Bildinformationen, Quick Look) schließen |

### Leuchttisch

| Taste | Wirkung |
|---|---|
| `←` `→` | Zum vorherigen/nächsten Foto blättern |
| `V` | Verschieben vormerken |
| `L` | Löschen vormerken |
| `X` | Aktion aufheben |
| `1`–`9` | Favorit-Stichwort zuweisen/entfernen |
| `T` | Seitenpanel ein-/ausblenden |
| `I` | Bildinformationen ein-/ausblenden |
| `M` | Lupe ein-/ausblenden |
| `Escape` | Schließt zuerst die Lupe, dann die Bildinformationen, zuletzt den Leuchttisch |

**Grundprinzip:** Dieselbe Aktion hat in beiden Ansichten immer dieselbe Taste (`V`, `L`, `X`, `1`–`9`, `T`, `I`, `Escape`). Nur Funktionen, die es ausschließlich in einer Ansicht gibt (Quick Look im Grid, die Lupe im Leuchttisch), haben dort eine eigene, in der anderen Ansicht ungenutzte Taste.
