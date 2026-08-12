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
14. [Vorschau des Durchgangs](#vorschau-des-durchgangs)
15. [Sicherheit beim Verschieben](#sicherheit-beim-verschieben)
16. [Protokoll und Rückgängig](#protokoll-und-rückgängig)
17. [Unterbrochene Sichtung fortsetzen](#unterbrochene-sichtung-fortsetzen)
18. [Programmeinstellungen: Export/Import](#programmeinstellungen-exportimport)
19. [Alle Tastenkürzel im Überblick](#alle-tastenkürzel-im-überblick)

---

## Voraussetzungen

Foto-Importer benötigt einen Chromium-basierten Browser (**Chrome** oder **Edge**, Desktop). Die zugrundeliegende File System Access API, die direkten Lese-/Schreibzugriff auf lokale Ordner ermöglicht, ist in Firefox und Safari nicht verfügbar. Öffnet man das Programm in einem nicht unterstützten Browser, erscheint beim Start ein entsprechender Hinweis.

Es ist keine Installation nötig – `index.html` wird direkt im Browser geöffnet.

## Erste Schritte

1. **Quellverzeichnis öffnen**: Button „📂 Quellverzeichnis öffnen“ in der Toolbar. Der Browser fragt einmalig nach Zugriffsrechten für den gewählten Ordner.
2. **Zielverzeichnis wählen**: Button „🎯 Zielverzeichnis wählen“ – wird erst benötigt, wenn tatsächlich Fotos verschoben werden sollen.
3. Alle unterstützten Bildformate im Quellordner werden als Vorschau-Kacheln im Grid angezeigt, sortiert nach Aufnahmedatum (änderbar, siehe [Sortierung](#sortierung-und-filterung)).

Standardmäßig werden nur Dateien **direkt im gewählten Ordner** gelesen. Der Schalter **Unterordner** neben dem Ordnernamen bezieht auch alle Unterordner ein; versteckte Ordner (Name beginnt mit einem Punkt) bleiben dabei außen vor, dort liegen auf Speicherkarten üblicherweise nur Papierkorb- und Indexdaten des Systems. Bei eingeschaltetem Schalter zeigt jede Kachel zusätzlich den Unterordner an, damit gleichnamige Dateien unterscheidbar bleiben.

Das Quellverzeichnis wird mit Schreibrechten geöffnet, weil beim Verschieben und Löschen Dateien daraus entfernt werden.

Markierungen und zugewiesene Stichworte überstehen ein Neuladen der Seite – siehe [Unterbrochene Sichtung fortsetzen](#unterbrochene-sichtung-fortsetzen). Der Stichwortkatalog und die Namensschema-Voreinstellungen werden ohnehin dauerhaft gespeichert.

## Die Gridansicht

Jede Kachel zeigt eine Bildvorschau, den Dateinamen sowie optische Hinweise auf:

- **Zugewiesene Aktion**: farbiger Rahmen und Beschriftung (grün = Verschieben, rot = Löschen)
- **Zugewiesene Stichworte**: kleine Chips am unteren Rand der Kachel (bis zu 3 sichtbar, „+N“ bei mehr) sowie ein 🏷-Symbol
- **Im Foto vorhandene, noch nicht übernommene Stichworte**: ein gestrichelter Chip „📄 N“ (siehe [Stichworte zuweisen](#stichworte-zuweisen))
- **Aktueller Cursor**: gelb hervorgehobener Rahmen
- **Mehrfachauswahl**: blau hervorgehobene Kacheln

Navigation erfolgt mit den **Pfeiltasten**. `Shift`+Pfeiltaste erweitert die Auswahl über einen Bereich. Mit der Maus: Klick wählt aus, `Strg`/`Cmd`+Klick fügt einzelne Kacheln zur Auswahl hinzu, `Shift`+Klick wählt einen Bereich.

Auch **RAW-Dateien** zeigen eine Vorschau. Der Browser kann RAW nicht selbst darstellen; das Programm schneidet stattdessen das JPEG-Vorschaubild heraus, das praktisch jede Kamera mit in die Datei legt. Findet sich keines, bleibt es bei einem grauen Kasten mit dem Formatkürzel.

## Aktionen: Verschieben und Löschen

Jedem Foto kann eine von drei Aktionen zugewiesen werden:

- **Verschieben** (`V`) – wird beim Ausführen ins Zielverzeichnis verschoben (siehe [Namensschema](#namensschema-beim-verschieben))
- **Löschen** (`L`) – wird beim Ausführen aus dem Quellverzeichnis entfernt
- **Keine Aktion** (`X`) – hebt eine zuvor gesetzte Aktion wieder auf

Diese Tasten wirken auf das aktuell angesteuerte Foto oder, falls eine Mehrfachauswahl aktiv ist, auf alle ausgewählten Fotos gleichzeitig.

Der Button „**Aktionen ausführen ▶**“ oben rechts startet den Durchgang. Ist mindestens ein Foto zum Verschieben markiert, fragt das Programm zuvor nach einer Ereignisbeschreibung (siehe [Namensschema](#namensschema-beim-verschieben)).

Anschließend erscheint in jedem Fall die [Vorschau des Durchgangs](#vorschau-des-durchgangs): sie zeigt jede einzelne geplante Änderung, bevor irgendetwas geschieht. Gelöschte Dateien landen **nicht im Papierkorb** und lassen sich nicht wiederherstellen.

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

### Bereits im Foto vorhandene Stichworte

Fotos, die schon einmal verschlagwortet wurden, bringen ihre Stichworte in den IPTC/XMP-Metadaten mit. Das Programm liest sie beim Einlesen mit und zeigt sie im Zuweisungs-Panel und im Seitenpanel des Leuchttischs unter **„Im Foto gefundene Stichworte“** an – als gestrichelte Chips, weil sie noch nicht zugewiesen sind.

Ein Klick übernimmt ein Stichwort (ein weiterer Klick nimmt die Übernahme zurück), „Alle übernehmen“ übernimmt sie auf einmal. Bei einer Mehrfachauswahl steht an jedem Chip, auf wie vielen der ausgewählten Fotos das Stichwort vorkommt.

Übernommen wird **nichts von selbst**: was in der Datei steht, ist eine Aussage des Programms, das sie zuletzt beschrieben hat. Erst die Übernahme macht daraus eine eigene Zuweisung – und nur zugewiesene Stichworte werden beim Verschieben in die Zieldatei geschrieben.

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

### Unterordner im Zielverzeichnis

Statt alle Fotos in einen Ordner zu legen, kann das Zielverzeichnis gegliedert werden. Die Auswahl steht im selben Dialog:

| Einstellung | Ergebnis |
|---|---|
| Kein Unterordner | alles direkt ins Zielverzeichnis |
| Jahr | `2026/` |
| Jahr / Jahr-Monat | `2026/2026-08/` |
| Jahr / Jahr-Monat / Jahr-Monat-Tag | `2026/2026-08/2026-08-12/` |
| Ereignis | `Sommerurlaub/` |
| Jahr / Ereignis | `2026/Sommerurlaub/` |

Maßgeblich ist das **Aufnahmedatum** des jeweiligen Fotos, nicht das Datum des Durchgangs. Fehlende Ordner werden angelegt. Ordnernamen werden genauso bereinigt wie Dateinamen; ein Schrägstrich im Ereignistext erzeugt also keine zusätzliche Ebene.

Schemata und die Unterordner-Einstellung lassen sich zusammen als benannte Voreinstellung speichern und später wieder laden.

Beim Ausführen der Verschieben-Aktion (sofern mindestens ein Foto markiert ist) fragt das Programm nach einer Ereignisbeschreibung, die sowohl in den Dateinamen einfließt als auch – unverändert, mit Leerzeichen statt Unterstrichen – als Beschreibung in die Metadaten der Datei geschrieben wird.

## Metadaten in den Dateien (IPTC/XMP)

Beim Verschieben werden zugewiesene Stichworte und die Ereignisbeschreibung nach Möglichkeit standardkonform in die Dateien geschrieben, damit andere Programme sie später zuverlässig wiederfinden können:

- **JPEG**: Stichworte werden als IPTC-IIM-Datensätze (Application Record, Keywords) sowie als XMP `dc:subject` direkt in die Datei eingebettet. Die Beschreibung entsprechend als IPTC Caption/Abstract und XMP `dc:description`. Alle übrigen Metadaten (EXIF, ICC-Profil) und die Bilddaten selbst bleiben dabei unverändert.
- **Alle Formate** (JPEG zusätzlich, alle anderen ausschließlich): eine **XMP-Sidecar-Datei** (`dateiname.xmp`) wird neben dem Foto abgelegt.

Schlägt das direkte Schreiben in eine JPEG-Datei aus irgendeinem Grund fehl oder liefert die Prüfung ein unerwartetes Ergebnis, greift automatisch der sichere Rückfall auf die unveränderte Originaldatei plus Sidecar – es wird nie eine unvollständig beschriebene Datei verwendet.

## Vorschau des Durchgangs

Bevor irgendetwas geschieht, zeigt das Programm den vollständigen Durchgang: **Quellname → Zielordner/Zielname** für jede zu verschiebende Datei und darunter jede Datei, die gelöscht werden soll. Erst „**Jetzt ausführen ▶**“ startet den Durchgang; „Abbrechen“ lässt alles unverändert.

Über der Liste stehen die Punkte, die man vorher wissen will:

- wie viele Dateien **endgültig gelöscht** werden (ohne Papierkorb),
- wie viele **Zielnamen bereits belegt** sind und deshalb ein Suffix `_1`, `_2` … bekommen (diese Zeilen sind in der Liste gelb hervorgehoben),
- in wie viele **Unterordner** einsortiert wird und dass fehlende davon angelegt werden.

Die Vorschau **verändert nichts**: sie legt keine Ordner an, schreibt keine Datei und löscht nichts. Sie wird mit denselben Funktionen berechnet, die anschließend auch ausführen – die angezeigten Namen sind also nicht geschätzt, sondern dieselben, die entstehen werden.

Die Dateinamen ermittelt der Durchgang trotzdem noch einmal neu. Käme zwischen Anzeige und Ausführung eine gleichnamige Datei ins Zielverzeichnis, wäre die Prüfung unmittelbar vor dem Schreiben der einzige Schutz davor, sie zu überschreiben.

## Sicherheit beim Verschieben

Es wird **nie eine vorhandene Datei im Zielverzeichnis überschrieben**. Vor dem Schreiben prüft das Programm, ob der geplante Name dort (oder als zugehörige `.xmp`-Datei) bereits vergeben ist, und weicht andernfalls auf `name_1`, `name_2` usw. aus. Das gilt auch über mehrere Durchgänge und Programmstarts hinweg.

Nach dem Schreiben der Zieldatei prüft das Programm aktiv, **bevor** die Quelldatei gelöscht wird:

1. **Größe** der neu geschriebenen Zieldatei
2. **Prüfsumme der Bilddaten** (SHA-256) – bei JPEG wird nur der garantiert unveränderte Bildanteil verglichen, bei anderen Formaten die komplette Datei
3. **Metadaten** (Stichworte/Beschreibung), sofern sie in die Datei eingebettet wurden
4. **XMP-Sidecar-Datei**, sofern eine geschrieben wurde – sie wird ebenfalls zurückgelesen und verglichen, denn für Formate ohne Direkteinbettung ist sie die einzige Ablage der Metadaten

Schlägt eine dieser Prüfungen fehl, wird die Quelldatei **nicht gelöscht**, das Foto bleibt im Grid sichtbar (mit zurückgesetzter Aktion), und eine Meldung weist auf die betroffene Datei hin. Die möglicherweise unvollständige Zieldatei wird bewusst nicht automatisch entfernt, damit sie manuell geprüft werden kann.

## Protokoll und Rückgängig

### Protokolldatei

Jeder Durchgang wird im Zielverzeichnis in der Datei `foto-importer-protokoll.txt` festgehalten: Zeitpunkt, Quell- und Zielordner, jede Verschiebung mit Quell- und Zielnamen sowie jede Löschung. Neue Durchgänge werden angehängt, nichts wird ersetzt.

Für gelöschte Dateien ist diese Datei das Einzige, was bleibt – wiederherstellen lassen sie sich nicht. Zu wissen, *was* gelöscht wurde, ist dann immer noch besser als nichts.

Lässt sich die Protokolldatei nicht schreiben, gilt der Durchgang trotzdem als gelungen: die Fotos liegen bereits richtig. Es erscheint nur ein Hinweis.

### Rückgängig

Nach einem Durchgang mit Verschiebungen erscheint in der Toolbar der Button „**↩ N zurück**“. Er bewegt die verschobenen Dateien an ihren Ursprungsort zurück und nimmt die Fotos wieder in die Liste auf, samt zugewiesener Stichworte.

Grenzen, die man kennen sollte:

- Es geht nur um den **letzten** Durchgang und nur **innerhalb derselben Sitzung** – nach einem Neuladen der Seite steht der Button nicht mehr zur Verfügung.
- **Gelöschte Dateien sind davon nicht erfasst.** Sie sind endgültig weg.
- Liegt im Quellordner inzwischen eine Datei gleichen Namens, wird auf `name_1` ausgewichen.

Das Zurückbewegen folgt derselben Reihenfolge wie das Verschieben: schreiben, prüfen, erst danach die Datei im Zielverzeichnis löschen. Schlägt die Prüfung fehl, bleibt die Datei im Zielverzeichnis liegen – im schlechtesten Fall existiert sie dann zweimal, was besser ist als keinmal.

## Unterbrochene Sichtung fortsetzen

Markierungen und zugewiesene Stichworte werden laufend gesichert. Wird die Seite neu geladen oder der Browser geschlossen, erscheint beim nächsten Start ein Balken über dem Grid: **„Unterbrochene Sichtung vom … fortsetzen“**.

- **Sitzung fortsetzen** fragt die Zugriffsrechte für den Ordner erneut ab (der Browser verlangt das nach einem Neustart immer), liest das Quellverzeichnis frisch ein und überträgt die gesicherten Markierungen auf die Fotos, die noch da sind.
- **Verwerfen** löscht den gesicherten Stand.

Fotos, die inzwischen nicht mehr im Ordner liegen, werden gemeldet und übersprungen – ihre Markierung wandert nicht auf eine andere Datei. War auch ein Zielverzeichnis gewählt und gilt dessen Berechtigung noch, wird es mit übernommen.

Gesichert wird nur, was sich nicht wieder einlesen lässt: die beiden Ordner sowie je Foto Pfad, Name, Markierung und Stichworte. Keine Bilddaten, keine Vorschauen.

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
