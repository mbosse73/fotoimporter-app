/**
 * ERZEUGTE DATEI - NICHT VON HAND BEARBEITEN.
 *
 * Quelle: HANDBUCH.md
 * Erzeugt mit: node tools/sync-help.js
 *
 * Aenderungen gehoeren ins Handbuch; dieses Skript zieht die eingebaute Hilfe
 * (F1) daraus nach. run-all.js prueft, dass beide zusammenpassen.
 */

const HELP_CHAPTERS = [
  {
    id: "voraussetzungen",
    title: "Voraussetzungen",
    html: `
      <h3>Voraussetzungen</h3>
      <p>Foto-Importer benötigt einen Chromium-basierten Browser (<b>Chrome</b> oder <b>Edge</b>, Desktop). Die zugrundeliegende File System Access API, die direkten Lese-/Schreibzugriff auf lokale Ordner ermöglicht, ist in Firefox und Safari nicht verfügbar. Öffnet man das Programm in einem nicht unterstützten Browser, erscheint beim Start ein entsprechender Hinweis.</p>
      <p>Es ist keine Installation nötig – <kbd>index.html</kbd> wird direkt im Browser geöffnet.</p>
    `,
  },
  {
    id: "erste-schritte",
    title: "Erste Schritte",
    html: `
      <h3>Erste Schritte</h3>
      <ol><li><b>Quellverzeichnis öffnen</b>: Button „📂 Quellverzeichnis öffnen“ in der Toolbar. Der Browser fragt einmalig nach Zugriffsrechten für den gewählten Ordner.</li><li><b>Zielverzeichnis wählen</b>: Button „🎯 Zielverzeichnis wählen“ – wird erst benötigt, wenn tatsächlich Fotos verschoben werden sollen.</li><li>Alle unterstützten Bildformate im Quellordner werden als Vorschau-Kacheln im Grid angezeigt, sortiert nach Aufnahmedatum (änderbar, siehe Sortierung).</li></ol>
      <p>Standardmäßig werden nur Dateien <b>direkt im gewählten Ordner</b> gelesen. Der Schalter <b>Unterordner</b> neben dem Ordnernamen bezieht auch alle Unterordner ein; versteckte Ordner (Name beginnt mit einem Punkt) bleiben dabei außen vor, dort liegen auf Speicherkarten üblicherweise nur Papierkorb- und Indexdaten des Systems. Bei eingeschaltetem Schalter zeigt jede Kachel zusätzlich den Unterordner an, damit gleichnamige Dateien unterscheidbar bleiben.</p>
      <p>Das Quellverzeichnis wird mit Schreibrechten geöffnet, weil beim Verschieben und Löschen Dateien daraus entfernt werden.</p>
      <p>Markierungen und zugewiesene Stichworte überstehen ein Neuladen der Seite – siehe Unterbrochene Sichtung fortsetzen. Der Stichwortkatalog und die Namensschema-Voreinstellungen werden ohnehin dauerhaft gespeichert.</p>
    `,
  },
  {
    id: "die-gridansicht",
    title: "Die Gridansicht",
    html: `
      <h3>Die Gridansicht</h3>
      <p>Jede Kachel zeigt eine Bildvorschau, den Dateinamen sowie optische Hinweise auf:</p>
      <ul><li><b>Zugewiesene Aktion</b>: farbiger Rahmen und Beschriftung (grün = Verschieben, rot = Löschen)</li><li><b>Zugewiesene Stichworte</b>: kleine Chips am unteren Rand der Kachel (bis zu 3 sichtbar, „+N“ bei mehr) sowie ein 🏷-Symbol</li><li><b>Im Foto vorhandene, noch nicht übernommene Stichworte</b>: ein gestrichelter Chip „📄 N“ (siehe Stichworte zuweisen)</li><li><b>Aktueller Cursor</b>: gelb hervorgehobener Rahmen</li><li><b>Mehrfachauswahl</b>: blau hervorgehobene Kacheln</li></ul>
      <p>Navigation erfolgt mit den <b>Pfeiltasten</b>. <kbd>Shift</kbd>+Pfeiltaste erweitert die Auswahl über einen Bereich. Mit der Maus: Klick wählt aus, <kbd>Strg</kbd>/<kbd>Cmd</kbd>+Klick fügt einzelne Kacheln zur Auswahl hinzu, <kbd>Shift</kbd>+Klick wählt einen Bereich.</p>
      <p>Auch <b>RAW-Dateien</b> zeigen eine Vorschau. Der Browser kann RAW nicht selbst darstellen; das Programm schneidet stattdessen das JPEG-Vorschaubild heraus, das praktisch jede Kamera mit in die Datei legt. Findet sich keines, bleibt es bei einem grauen Kasten mit dem Formatkürzel.</p>
    `,
  },
  {
    id: "aktionen-verschieben-und-löschen",
    title: "Aktionen: Verschieben und Löschen",
    html: `
      <h3>Aktionen: Verschieben und Löschen</h3>
      <p>Jedem Foto kann eine von drei Aktionen zugewiesen werden:</p>
      <ul><li><b>Verschieben</b> (<kbd>V</kbd>) – wird beim Ausführen ins Zielverzeichnis verschoben (siehe Namensschema)</li><li><b>Löschen</b> (<kbd>L</kbd>) – wird beim Ausführen aus dem Quellverzeichnis entfernt</li><li><b>Keine Aktion</b> (<kbd>X</kbd>) – hebt eine zuvor gesetzte Aktion wieder auf</li></ul>
      <p>Diese Tasten wirken auf das aktuell angesteuerte Foto oder, falls eine Mehrfachauswahl aktiv ist, auf alle ausgewählten Fotos gleichzeitig.</p>
      <p>Der Button „<b>Aktionen ausführen ▶</b>“ oben rechts startet den Durchgang. Ist mindestens ein Foto zum Verschieben markiert, fragt das Programm zuvor nach einer Ereignisbeschreibung (siehe Namensschema).</p>
      <p>Anschließend erscheint in jedem Fall die Vorschau des Durchgangs: sie zeigt jede einzelne geplante Änderung, bevor irgendetwas geschieht. Gelöschte Dateien landen <b>nicht im Papierkorb</b> und lassen sich nicht wiederherstellen.</p>
      <p>Die Tastenkürzel wirken nur als einzelne Tasten. <kbd>Strg</kbd>/<kbd>Cmd</kbd> in Kombination (z. B. <kbd>Strg</kbd>+<kbd>V</kbd> zum Einfügen) bleibt dem Browser überlassen und löst keine Aktion im Programm aus – einzige Ausnahme ist <kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>A</kbd> für „alles auswählen“.</p>
    `,
  },
  {
    id: "sortierung-und-filterung",
    title: "Sortierung und Filterung",
    html: `
      <h3>Sortierung und Filterung</h3>
      <p><b>Sortierung</b> (Toolbar): Dropdown mit vier Kriterien – Dateiname (natürliche Sortierung, d. h. <kbd>IMG_2</kbd> vor <kbd>IMG_10</kbd>), Dateidatum, Aufnahmedatum (EXIF mit Fallback auf Dateidatum) und Dateigröße. Der Button daneben kehrt die Richtung um (↑/↓). Der Cursor bleibt beim Umsortieren auf demselben Foto, nicht auf derselben Position.</p>
      <p><b>Filterung</b> (Toolbar): sechs Filter-Buttons, jeweils nur einer aktiv gleichzeitig, nicht kombinierbar:</p>
      <ul><li>Alle</li><li>Nur zum Verschieben markierte</li><li>Nur zum Löschen markierte</li><li>Nur unmarkierte</li><li>Nur Fotos <b>mit</b> Stichworten</li><li>Nur Fotos <b>ohne</b> Stichworte</li></ul>
      <p>Der Leuchttisch respektiert beim Blättern denselben Filter und dieselbe Sortierung wie das Grid.</p>
    `,
  },
  {
    id: "der-stichwortkatalog",
    title: "Der Stichwortkatalog",
    html: `
      <h3>Der Stichwortkatalog</h3>
      <p>Über „🏷️ Stichwortkatalog…“ in der Toolbar erreichbar. Drei Bereiche:</p>
      <ul><li><b>Gruppen</b> – thematisch zusammengehörende Stichworte (z. B. „Landschaft“: Strand, Wald, Meer)</li><li><b>Sets</b> – ereignisbezogene Bündel (z. B. „Hochzeit“: Kleid, Braut, Feier)</li><li><b>⭐ Favoriten</b> – neun Slots für Schnellzugriff per Zifferntaste</li></ul>
      <p>Stichworte gehören zu einem gemeinsamen Pool: dasselbe Stichwort kann gleichzeitig in mehreren Gruppen und Sets vorkommen. Wird es umbenannt, ändert sich das überall; wird es aus einem einzelnen Bereich entfernt, bleibt es im Pool und in anderen Bereichen erhalten. Nur die komplette Löschung (🗑-Symbol) entfernt es überall, auch aus belegten Favoriten-Slots.</p>
      <p>Favoriten können entweder aus dem Katalog gewählt oder als komplett freier Text eingegeben werden.</p>
      <p>Export/Import des Katalogs als eigenständige <kbd>.json</kbd>-Datei über die Buttons im Dialog-Footer.</p>
    `,
  },
  {
    id: "stichworte-zuweisen",
    title: "Stichworte zuweisen",
    html: `
      <h3>Stichworte zuweisen</h3>
      <p>Im Grid: Taste <kbd>T</kbd> öffnet ein Zuweisungs-Panel mit Favoriten (anklickbar), Gruppen/Sets (als Toggle-Chips – ein Klick weist alle enthaltenen Stichworte zu, ein erneuter Klick entfernt sie wieder komplett) sowie einer durchsuchbaren Liste aller Katalog-Stichworte. Wirkt auf das aktuelle Foto oder die Mehrfachauswahl.</p>
      <p>Zusätzlich lassen sich die neun Favoriten direkt per Zifferntaste <kbd>1</kbd>–<kbd>9</kbd> zuweisen bzw. per erneutem Druck wieder entfernen (Toggle).</p>
      <p>Bei einer Mehrfachauswahl mit gemischtem Zustand (manche Fotos haben das Stichwort bereits, andere nicht) wird beim Toggle immer <b>ergänzt</b>, nie entfernt – ein versehentliches Löschen bestehender Zuweisungen wird so vermieden. Nur wenn wirklich *alle* ausgewählten Fotos ein Stichwort bereits tragen, entfernt ein erneuter Toggle es bei allen.</p>
      <p>Im Leuchttisch steht dieselbe Zuweisungsfunktion über ein Seitenpanel zur Verfügung (siehe unten).</p>
      <h4>Bereits im Foto vorhandene Stichworte</h4>
      <p>Fotos, die schon einmal verschlagwortet wurden, bringen ihre Stichworte in den IPTC/XMP-Metadaten mit. Das Programm liest sie beim Einlesen mit und zeigt sie im Zuweisungs-Panel und im Seitenpanel des Leuchttischs unter <b>„Im Foto gefundene Stichworte“</b> an – als gestrichelte Chips, weil sie noch nicht zugewiesen sind.</p>
      <p>Ein Klick übernimmt ein Stichwort (ein weiterer Klick nimmt die Übernahme zurück), „Alle übernehmen“ übernimmt sie auf einmal. Bei einer Mehrfachauswahl steht an jedem Chip, auf wie vielen der ausgewählten Fotos das Stichwort vorkommt.</p>
      <p>Übernommen wird <b>nichts von selbst</b>: was in der Datei steht, ist eine Aussage des Programms, das sie zuletzt beschrieben hat. Erst die Übernahme macht daraus eine eigene Zuweisung – und nur zugewiesene Stichworte werden beim Verschieben in die Zieldatei geschrieben.</p>
    `,
  },
  {
    id: "der-leuchttisch",
    title: "Der Leuchttisch",
    html: `
      <h3>Der Leuchttisch</h3>
      <p><kbd>Enter</kbd> öffnet den Leuchttisch für das aktuell angesteuerte Foto. Er zeigt das Foto möglichst groß, mit:</p>
      <ul><li><b>Filmstreifen</b> unten: Vorschaubilder benachbarter Fotos zum direkten Anspringen, mit denselben Aktions-/Stichwort-Indikatoren wie im Grid</li><li><b>Seitenpanel</b> (Taste <kbd>T</kbd> oder Button „🏷️ Panel“, ein-/ausblendbar): identische Stichwort-Zuweisung wie im Grid-Panel, plus die Aktions-Buttons</li><li><b>Stichwort-Chips</b> direkt über dem Bild, auch bei ausgeblendetem Panel sichtbar</li></ul>
      <p>Zugewiesene Stichworte und Aktionen sind zwischen Grid und Leuchttisch in Echtzeit synchron – eine Änderung an einer Stelle erscheint sofort auch an der anderen.</p>
      <p><kbd>Pfeil links/rechts</kbd> blättert innerhalb der aktuellen Sortierung/Filterung. <kbd>Escape</kbd> schließt den Leuchttisch (bzw. zunächst offene Overlays, siehe Tastenkürzel).</p>
    `,
  },
  {
    id: "bildinformationen-exif",
    title: "Bildinformationen (EXIF)",
    html: `
      <h3>Bildinformationen (EXIF)</h3>
      <p>Taste <kbd>I</kbd> blendet ein Info-Panel mit Kamera, Belichtungsdaten (Zeit, Blende, ISO, Brennweite), Blitz, Weißabgleich, GPS-Koordinaten (falls vorhanden), Aufnahmedatum, Bildabmessungen und Dateigröße ein.</p>
      <ul><li><b>Im Leuchttisch</b>: erscheint dezent oben rechts über dem Bild, aktualisiert sich automatisch beim Blättern.</li><li><b>Im Grid</b>: nur verfügbar, wenn <b>genau ein</b> Foto ausgewählt ist. Erscheint direkt neben der Kachel (weicht bei Platzmangel automatisch zur anderen Seite aus).</li></ul>
      <p><kbd>Escape</kbd> schließt das Panel.</p>
    `,
  },
  {
    id: "ganzes-foto-anzeigen-quick-look",
    title: "Ganzes Foto anzeigen (Quick Look)",
    html: `
      <h3>Ganzes Foto anzeigen (Quick Look)</h3>
      <p>Im Grid öffnet die <b>Leertaste</b> bei genau einem angesteuerten Foto eine schnelle, bildschirmfüllende Vorschau ohne weitere Bedienelemente – vergleichbar mit macOS Quick Look. <kbd>Escape</kbd> oder Klick auf den Hintergrund schließt sie wieder.</p>
      <p>Ist eine Mehrfachauswahl aktiv, hat die Leertaste stattdessen ihre andere Funktion: sie schaltet das aktuell angesteuerte Foto in der Auswahl an oder aus.</p>
    `,
  },
  {
    id: "die-lupe",
    title: "Die Lupe",
    html: `
      <h3>Die Lupe</h3>
      <p>Nur im Leuchttisch: Taste <kbd>M</kbd> blendet eine runde Lupe ein, die dem Mauszeiger folgt und einen 2,5-fach vergrößerten Bildausschnitt zeigt. Für die Lupe wird bei Bedarf eine möglichst hochauflösende Version des Fotos geladen, damit auch feine Details erkennbar sind. <kbd>Escape</kbd> schließt die Lupe zuerst, bevor ein zweites <kbd>Escape</kbd> den Leuchttisch verlässt.</p>
    `,
  },
  {
    id: "namensschema-beim-verschieben",
    title: "Namensschema beim Verschieben",
    html: `
      <h3>Namensschema beim Verschieben</h3>
      <p>Über „⚙️ Namensschema…“ lässt sich der Ziel-Dateiname aus Bausteinen zusammensetzen, per Drag &amp; Drop in beliebiger Reihenfolge:</p>
      <ul><li><b>Datum</b> (JJJJMMTT, Aufnahmedatum)</li><li><b>Ereignis</b> (die beim Verschieben abgefragte Beschreibung, Leerzeichen werden zu Unterstrichen, in Dateinamen unzulässige Zeichen wie <kbd>/ \\ : * ? &quot; &lt; &gt; |</kbd> zu Bindestrichen)</li><li><b>Zähler</b> (Startwert und Stellenzahl einstellbar)</li><li><b>Freitext</b> (fest hinterlegter Text)</li><li><b>Trenner</b> (Unterstrich oder Bindestrich)</li></ul>
      <h4>Unterordner im Zielverzeichnis</h4>
      <p>Statt alle Fotos in einen Ordner zu legen, kann das Zielverzeichnis gegliedert werden. Die Auswahl steht im selben Dialog:</p>
      <table class="helpTable"><thead><tr><th>Einstellung</th><th>Ergebnis</th></tr></thead><tbody><tr><td>Kein Unterordner</td><td>alles direkt ins Zielverzeichnis</td></tr><tr><td>Jahr</td><td><kbd>2026/</kbd></td></tr><tr><td>Jahr / Jahr-Monat</td><td><kbd>2026/2026-08/</kbd></td></tr><tr><td>Jahr / Jahr-Monat / Jahr-Monat-Tag</td><td><kbd>2026/2026-08/2026-08-12/</kbd></td></tr><tr><td>Ereignis</td><td><kbd>Sommerurlaub/</kbd></td></tr><tr><td>Jahr / Ereignis</td><td><kbd>2026/Sommerurlaub/</kbd></td></tr></tbody></table>
      <p>Maßgeblich ist das <b>Aufnahmedatum</b> des jeweiligen Fotos, nicht das Datum des Durchgangs. Fehlende Ordner werden angelegt. Ordnernamen werden genauso bereinigt wie Dateinamen; ein Schrägstrich im Ereignistext erzeugt also keine zusätzliche Ebene.</p>
      <p>Schemata und die Unterordner-Einstellung lassen sich zusammen als benannte Voreinstellung speichern und später wieder laden.</p>
      <p>Beim Ausführen der Verschieben-Aktion (sofern mindestens ein Foto markiert ist) fragt das Programm nach einer Ereignisbeschreibung, die sowohl in den Dateinamen einfließt als auch – unverändert, mit Leerzeichen statt Unterstrichen – als Beschreibung in die Metadaten der Datei geschrieben wird.</p>
    `,
  },
  {
    id: "metadaten-in-den-dateien-iptcxmp",
    title: "Metadaten in den Dateien (IPTC/XMP)",
    html: `
      <h3>Metadaten in den Dateien (IPTC/XMP)</h3>
      <p>Beim Verschieben werden zugewiesene Stichworte und die Ereignisbeschreibung nach Möglichkeit standardkonform in die Dateien geschrieben, damit andere Programme sie später zuverlässig wiederfinden können:</p>
      <ul><li><b>JPEG</b>: Stichworte werden als IPTC-IIM-Datensätze (Application Record, Keywords) sowie als XMP <kbd>dc:subject</kbd> direkt in die Datei eingebettet. Die Beschreibung entsprechend als IPTC Caption/Abstract und XMP <kbd>dc:description</kbd>. Alle übrigen Metadaten (EXIF, ICC-Profil) und die Bilddaten selbst bleiben dabei unverändert.</li><li><b>Alle Formate</b> (JPEG zusätzlich, alle anderen ausschließlich): eine <b>XMP-Sidecar-Datei</b> (<kbd>dateiname.xmp</kbd>) wird neben dem Foto abgelegt.</li></ul>
      <p>Schlägt das direkte Schreiben in eine JPEG-Datei aus irgendeinem Grund fehl oder liefert die Prüfung ein unerwartetes Ergebnis, greift automatisch der sichere Rückfall auf die unveränderte Originaldatei plus Sidecar – es wird nie eine unvollständig beschriebene Datei verwendet.</p>
    `,
  },
  {
    id: "vorschau-des-durchgangs",
    title: "Vorschau des Durchgangs",
    html: `
      <h3>Vorschau des Durchgangs</h3>
      <p>Bevor irgendetwas geschieht, zeigt das Programm den vollständigen Durchgang: <b>Quellname → Zielordner/Zielname</b> für jede zu verschiebende Datei und darunter jede Datei, die gelöscht werden soll. Erst „<b>Jetzt ausführen ▶</b>“ startet den Durchgang; „Abbrechen“ lässt alles unverändert.</p>
      <p>Über der Liste stehen die Punkte, die man vorher wissen will:</p>
      <ul><li>wie viele Dateien <b>endgültig gelöscht</b> werden (ohne Papierkorb),</li><li>wie viele <b>Zielnamen bereits belegt</b> sind und deshalb ein Suffix <kbd>_1</kbd>, <kbd>_2</kbd> … bekommen (diese Zeilen sind in der Liste gelb hervorgehoben),</li><li>in wie viele <b>Unterordner</b> einsortiert wird und dass fehlende davon angelegt werden.</li></ul>
      <p>Die Vorschau <b>verändert nichts</b>: sie legt keine Ordner an, schreibt keine Datei und löscht nichts. Sie wird mit denselben Funktionen berechnet, die anschließend auch ausführen – die angezeigten Namen sind also nicht geschätzt, sondern dieselben, die entstehen werden.</p>
      <p>Die Dateinamen ermittelt der Durchgang trotzdem noch einmal neu. Käme zwischen Anzeige und Ausführung eine gleichnamige Datei ins Zielverzeichnis, wäre die Prüfung unmittelbar vor dem Schreiben der einzige Schutz davor, sie zu überschreiben.</p>
    `,
  },
  {
    id: "sicherheit-beim-verschieben",
    title: "Sicherheit beim Verschieben",
    html: `
      <h3>Sicherheit beim Verschieben</h3>
      <p>Es wird <b>nie eine vorhandene Datei im Zielverzeichnis überschrieben</b>. Vor dem Schreiben prüft das Programm, ob der geplante Name dort (oder als zugehörige <kbd>.xmp</kbd>-Datei) bereits vergeben ist, und weicht andernfalls auf <kbd>name_1</kbd>, <kbd>name_2</kbd> usw. aus. Das gilt auch über mehrere Durchgänge und Programmstarts hinweg.</p>
      <p>Nach dem Schreiben der Zieldatei prüft das Programm aktiv, <b>bevor</b> die Quelldatei gelöscht wird:</p>
      <ol><li><b>Größe</b> der neu geschriebenen Zieldatei</li><li><b>Prüfsumme der Bilddaten</b> (SHA-256) – bei JPEG wird nur der garantiert unveränderte Bildanteil verglichen, bei anderen Formaten die komplette Datei</li><li><b>Metadaten</b> (Stichworte/Beschreibung), sofern sie in die Datei eingebettet wurden</li><li><b>XMP-Sidecar-Datei</b>, sofern eine geschrieben wurde – sie wird ebenfalls zurückgelesen und verglichen, denn für Formate ohne Direkteinbettung ist sie die einzige Ablage der Metadaten</li></ol>
      <p>Schlägt eine dieser Prüfungen fehl, wird die Quelldatei <b>nicht gelöscht</b>, das Foto bleibt im Grid sichtbar (mit zurückgesetzter Aktion), und eine Meldung weist auf die betroffene Datei hin. Die möglicherweise unvollständige Zieldatei wird bewusst nicht automatisch entfernt, damit sie manuell geprüft werden kann.</p>
    `,
  },
  {
    id: "protokoll-und-rückgängig",
    title: "Protokoll und Rückgängig",
    html: `
      <h3>Protokoll und Rückgängig</h3>
      <h4>Protokolldatei</h4>
      <p>Jeder Durchgang wird im Zielverzeichnis in der Datei <kbd>foto-importer-protokoll.txt</kbd> festgehalten: Zeitpunkt, Quell- und Zielordner, jede Verschiebung mit Quell- und Zielnamen sowie jede Löschung. Neue Durchgänge werden angehängt, nichts wird ersetzt.</p>
      <p>Für gelöschte Dateien ist diese Datei das Einzige, was bleibt – wiederherstellen lassen sie sich nicht. Zu wissen, *was* gelöscht wurde, ist dann immer noch besser als nichts.</p>
      <p>Lässt sich die Protokolldatei nicht schreiben, gilt der Durchgang trotzdem als gelungen: die Fotos liegen bereits richtig. Es erscheint nur ein Hinweis.</p>
      <h4>Rückgängig</h4>
      <p>Nach einem Durchgang mit Verschiebungen erscheint in der Toolbar der Button „<b>↩ N zurück</b>“. Er bewegt die verschobenen Dateien an ihren Ursprungsort zurück und nimmt die Fotos wieder in die Liste auf, samt zugewiesener Stichworte.</p>
      <p>Grenzen, die man kennen sollte:</p>
      <ul><li>Es geht nur um den <b>letzten</b> Durchgang und nur <b>innerhalb derselben Sitzung</b> – nach einem Neuladen der Seite steht der Button nicht mehr zur Verfügung.</li><li><b>Gelöschte Dateien sind davon nicht erfasst.</b> Sie sind endgültig weg.</li><li>Liegt im Quellordner inzwischen eine Datei gleichen Namens, wird auf <kbd>name_1</kbd> ausgewichen.</li></ul>
      <p>Das Zurückbewegen folgt derselben Reihenfolge wie das Verschieben: schreiben, prüfen, erst danach die Datei im Zielverzeichnis löschen. Schlägt die Prüfung fehl, bleibt die Datei im Zielverzeichnis liegen – im schlechtesten Fall existiert sie dann zweimal, was besser ist als keinmal.</p>
    `,
  },
  {
    id: "unterbrochene-sichtung-fortsetzen",
    title: "Unterbrochene Sichtung fortsetzen",
    html: `
      <h3>Unterbrochene Sichtung fortsetzen</h3>
      <p>Markierungen und zugewiesene Stichworte werden laufend gesichert. Wird die Seite neu geladen oder der Browser geschlossen, erscheint beim nächsten Start ein Balken über dem Grid: <b>„Unterbrochene Sichtung vom … fortsetzen“</b>.</p>
      <ul><li><b>Sitzung fortsetzen</b> fragt die Zugriffsrechte für den Ordner erneut ab (der Browser verlangt das nach einem Neustart immer), liest das Quellverzeichnis frisch ein und überträgt die gesicherten Markierungen auf die Fotos, die noch da sind.</li><li><b>Verwerfen</b> löscht den gesicherten Stand.</li></ul>
      <p>Fotos, die inzwischen nicht mehr im Ordner liegen, werden gemeldet und übersprungen – ihre Markierung wandert nicht auf eine andere Datei. War auch ein Zielverzeichnis gewählt und gilt dessen Berechtigung noch, wird es mit übernommen.</p>
      <p>Gesichert wird nur, was sich nicht wieder einlesen lässt: die beiden Ordner sowie je Foto Pfad, Name, Markierung und Stichworte. Keine Bilddaten, keine Vorschauen.</p>
    `,
  },
  {
    id: "programmeinstellungen-exportimport",
    title: "Programmeinstellungen: Export/Import",
    html: `
      <h3>Programmeinstellungen: Export/Import</h3>
      <p>Über „🛠️ Einstellungen…“ lassen sich alle Programmeinstellungen (Namensschema-Voreinstellungen, Stichwortkatalog) als Sicherung exportieren und auf einem anderen Rechner oder nach einem Neuladen wieder importieren.</p>
    `,
  },
  {
    id: "alle-tastenkürzel-im-überblick",
    title: "Alle Tastenkürzel im Überblick",
    html: `
      <h3>Alle Tastenkürzel im Überblick</h3>
      <h4>Gridansicht</h4>
      <table class="helpTable"><thead><tr><th>Taste</th><th>Wirkung</th></tr></thead><tbody><tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>Zwischen Fotos navigieren</td></tr><tr><td><kbd>Shift</kbd> + Pfeiltaste</td><td>Auswahlbereich erweitern</td></tr><tr><td><kbd>V</kbd></td><td>Markierte Fotos zum Verschieben vormerken</td></tr><tr><td><kbd>L</kbd></td><td>Markierte Fotos zum Löschen vormerken</td></tr><tr><td><kbd>X</kbd></td><td>Aktion aufheben</td></tr><tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Favorit-Stichwort zuweisen/entfernen</td></tr><tr><td><kbd>T</kbd></td><td>Stichwort-Zuweisungspanel öffnen</td></tr><tr><td><kbd>I</kbd></td><td>Bildinformationen anzeigen (nur bei genau einem ausgewählten Foto)</td></tr><tr><td><kbd>Leertaste</kbd></td><td>Ganzes Foto anzeigen (Einzelauswahl) / Auswahl umschalten (Mehrfachauswahl)</td></tr><tr><td><kbd>Strg</kbd>/<kbd>Cmd</kbd> + <kbd>A</kbd></td><td>Alle sichtbaren Fotos auswählen</td></tr><tr><td><kbd>Enter</kbd></td><td>Leuchttisch öffnen</td></tr><tr><td><kbd>Escape</kbd></td><td>Offenes Overlay (Bildinformationen, Quick Look) schließen</td></tr></tbody></table>
      <h4>Leuchttisch</h4>
      <table class="helpTable"><thead><tr><th>Taste</th><th>Wirkung</th></tr></thead><tbody><tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Zum vorherigen/nächsten Foto blättern</td></tr><tr><td><kbd>V</kbd></td><td>Verschieben vormerken</td></tr><tr><td><kbd>L</kbd></td><td>Löschen vormerken</td></tr><tr><td><kbd>X</kbd></td><td>Aktion aufheben</td></tr><tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Favorit-Stichwort zuweisen/entfernen</td></tr><tr><td><kbd>T</kbd></td><td>Seitenpanel ein-/ausblenden</td></tr><tr><td><kbd>I</kbd></td><td>Bildinformationen ein-/ausblenden</td></tr><tr><td><kbd>M</kbd></td><td>Lupe ein-/ausblenden</td></tr><tr><td><kbd>Escape</kbd></td><td>Schließt zuerst die Lupe, dann die Bildinformationen, zuletzt den Leuchttisch</td></tr></tbody></table>
      <p><b>Grundprinzip:</b> Dieselbe Aktion hat in beiden Ansichten immer dieselbe Taste (<kbd>V</kbd>, <kbd>L</kbd>, <kbd>X</kbd>, <kbd>1</kbd>–<kbd>9</kbd>, <kbd>T</kbd>, <kbd>I</kbd>, <kbd>Escape</kbd>). Nur Funktionen, die es ausschließlich in einer Ansicht gibt (Quick Look im Grid, die Lupe im Leuchttisch), haben dort eine eigene, in der anderen Ansicht ungenutzte Taste.</p>
    `,
  },
];

if (typeof module !== "undefined") {
  module.exports = { HELP_CHAPTERS };
}
