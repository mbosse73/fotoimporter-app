/**
 * Integrationstests für app.js.
 *
 * Dieses Skript wird von tests/browser.html IN das iframe der geladenen App
 * injiziert und läuft damit in deren Realm. Das ist der Grund für den Umweg über
 * ein iframe: app.js ist ein klassisches Skript, dessen Zustand (`state`,
 * `currentFormatTokens`, ...) als Top-Level-`const`/`let` im globalen lexikalischen
 * Scope liegt und deshalb NICHT über `window.` erreichbar ist. Ein Skript, das im
 * selben Realm nachgeladen wird, sieht diese Bindungen dagegen ganz normal.
 *
 * Die Verzeichnis-Handles werden durch Attrappen ersetzt. executeActions() läuft
 * damit vollständig durch - inklusive Metadaten schreiben, zurücklesen und
 * Quelldatei löschen -, ohne dass eine einzige echte Datei angefasst wird. Genau
 * das macht diese Tests überhaupt erst gefahrlos wiederholbar: der echte Pfad
 * löscht endgültig.
 */

(async function fotoImporterBrowserSuite() {
  "use strict";

  const ergebnisse = [];
  let aktuellerBereich = "";

  function bereich(name) { aktuellerBereich = name; }
  function pruefe(name, bedingung, detail) {
    ergebnisse.push({
      bereich: aktuellerBereich,
      name,
      bestanden: !!bedingung,
      detail: detail === undefined ? "" : String(detail),
    });
  }

  /* ============================================================
     ATTRAPPEN FÜR DIE FILE SYSTEM ACCESS API
     ============================================================ */

  class AttrappenVerzeichnis {
    constructor(name) {
      this.name = name;
      this.kind = "directory";
      this.files = new Map();
      this.unterordner = new Map(); // Name -> AttrappenVerzeichnis
      this.loeschenSchlaegtFehl = new Set(); // Dateinamen, deren Löschen scheitern soll
    }

    /** Wie die echte API: liefert [name, handle] für Dateien UND Unterordner. */
    async *entries() {
      for (const [name, datei] of this.files) {
        yield [name, { kind: "file", name, async getFile() { return datei; } }];
      }
      for (const [name, ordner] of this.unterordner) yield [name, ordner];
    }

    async getDirectoryHandle(name, options) {
      if (!this.unterordner.has(name)) {
        if (!options || !options.create) {
          const fehler = new Error(`Ordner "${name}" nicht gefunden`);
          fehler.name = "NotFoundError";
          throw fehler;
        }
        this.unterordner.set(name, new AttrappenVerzeichnis(name));
      }
      return this.unterordner.get(name);
    }

    async getFileHandle(name, options) {
      if (!this.files.has(name)) {
        if (!options || !options.create) {
          const fehler = new Error(`"${name}" nicht gefunden`);
          fehler.name = "NotFoundError";
          throw fehler;
        }
        this.files.set(name, new File([], name));
      }
      const verzeichnis = this;
      return {
        async getFile() { return verzeichnis.files.get(name); },
        async createWritable() {
          // Wie das Original: der bisherige Inhalt wird verworfen.
          const teile = [];
          return {
            async write(daten) { teile.push(daten); },
            async close() { verzeichnis.files.set(name, new File(teile, name)); },
          };
        },
      };
    }

    async removeEntry(name) {
      if (this.loeschenSchlaegtFehl.has(name)) throw new Error("Löschen simuliert fehlgeschlagen");
      if (!this.files.has(name)) {
        const fehler = new Error(`"${name}" nicht gefunden`);
        fehler.name = "NotFoundError";
        throw fehler;
      }
      this.files.delete(name);
    }

    namen() { return [...this.files.keys()].sort(); }

    /**
     * Nur die Fotodateien. Jeder Durchgang schreibt zusätzlich eine
     * Protokolldatei ins Zielverzeichnis (F5) - in Prüfungen, die von den
     * verschobenen Fotos handeln, ist sie nur Rauschen.
     */
    fotoNamen() { return this.namen().filter((n) => n !== PROTOCOL_FILE_NAME); }
  }

  /** Erzeugt ein echtes, decodierbares JPEG über den Canvas. */
  async function jpegDatei(beschriftung) {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c33";
    ctx.fillRect(0, 0, 48, 32);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(beschriftung || "x"), 2, 20);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return new File([blob], "quelle.jpg", { type: "image/jpeg" });
  }

  /**
   * Baut einen PhotoEntry, wie ihn loadPhotosFromSource() erzeugen würde.
   * `dirHandle` bleibt offen und wird in durchgang() auf das Quellverzeichnis
   * gesetzt - genau wie in der App, wo der enthaltende Ordner beim Einlesen
   * feststeht. Für Tests mit Unterordnern wird er vorher gezielt gesetzt.
   */
  function fotoEintrag(name, datei, stichworte, relPath) {
    return {
      name,
      ext: name.slice(name.lastIndexOf(".") + 1).toLowerCase(),
      handle: { async getFile() { return datei; } },
      dirHandle: null,
      relPath: relPath || "",
      existingKeywords: null,
      existingDescription: null,
      thumbUrl: null,
      largePreviewUrl: null,
      fullResUrl: null,
      thumbFailed: false,
      captureDate: new Date(2024, 4, 17),
      fileDate: new Date(2024, 4, 17),
      fileSize: datei.size,
      action: "none",
      assignedKeywords: stichworte || [],
    };
  }

  /** Setzt den App-Zustand auf die Attrappen und führt einen kompletten Durchgang aus. */
  async function durchgang(eintraege, quelle, ziel, ereignisText) {
    for (const e of eintraege) if (!e.dirHandle) e.dirHandle = quelle;
    state.photos = eintraege;
    state.sourceDirHandle = quelle;
    state.targetDirHandle = ziel;
    state.selectedIndices.clear();
    state.cursorIndex = eintraege.length > 0 ? 0 : -1;
    await executeActions(ereignisText === undefined ? "" : ereignisText);
  }

  /** Setzt das Namensschema für einen Test. */
  function namensschema(tokens, freitext) {
    currentFormatTokens = tokens;
    currentFreeText = freitext === undefined ? "" : freitext;
    currentCounterStart = 1;
    currentCounterDigits = 3;
  }

  const echtesConfirm = window.confirm;
  const echtesWriteKeywordsToJpeg = window.writeKeywordsToJpeg;
  window.confirm = () => true; // Löschabfrage: wird pro Test gezielt überschrieben

  try {
    /* ============================================================
       ESCAPING (Befund M1)
       ============================================================ */
    bereich("Escaping");

    pruefe("escapeHtml maskiert spitze Klammern", escapeHtml("<b>") === "&lt;b&gt;", escapeHtml("<b>"));
    pruefe("escapeHtml maskiert Anführungszeichen", escapeHtml('a"b') === "a&quot;b", escapeHtml('a"b'));
    pruefe("escapeHtml maskiert Apostrophe", escapeHtml("a'b") === "a&#39;b", escapeHtml("a'b"));
    pruefe("escapeHtml maskiert kaufmännisches Und zuerst", escapeHtml("&lt;") === "&amp;lt;", escapeHtml("&lt;"));

    {
      // Der eigentliche Angriff: ein Stichwort bricht aus dem value-Attribut aus.
      // Genau diese Form landet in renderKeywordChips() und renderContainerDetail().
      const boesartig = '" autofocus onfocus="window.__uebernommen=1';
      const probe = document.createElement("div");
      probe.innerHTML = `<input type="text" value="${escapeHtml(boesartig)}">`;
      const feld = probe.querySelector("input");
      pruefe(
        "kein Ausbruch aus einem Attributwert",
        feld && !feld.hasAttribute("onfocus") && !feld.hasAttribute("autofocus") && feld.value === boesartig,
        feld ? [...feld.attributes].map((a) => a.name).join(",") : "kein Eingabefeld"
      );
    }

    /* ============================================================
       IMPORT VON FREMDDATEN (Befund M1)
       ============================================================ */
    bereich("Import-Härtung");

    {
      const katalog = {
        keywords: [
          { id: "a", label: "gut" },
          { id: "b", label: 42 },     // Label ist keine Zeichenkette
          { id: "c", label: "" },     // leer
          "kaputt",
          null,
        ],
        groups: [{ id: "g", name: "G", keywordIds: ["a", "gibtsnicht"] }, 7, null],
        sets: "keine Liste",
        favorites: [{ type: "keyword", keywordId: "weg" }, { type: "free", label: "frei" }, { type: "unsinn" }],
      };
      normalizeKeywordCatalog(katalog);

      pruefe("nur wohlgeformte Stichworte überleben",
        katalog.keywords.length === 1 && katalog.keywords[0].label === "gut",
        JSON.stringify(katalog.keywords));
      pruefe("Verweise auf fehlende Stichworte fallen weg",
        katalog.groups.length === 1 && katalog.groups[0].keywordIds.length === 1,
        JSON.stringify(katalog.groups));
      pruefe("eine unbrauchbare Liste wird zur leeren Liste",
        Array.isArray(katalog.sets) && katalog.sets.length === 0);
      pruefe("Favoriten: genau 9 Slots, ungültige werden null",
        katalog.favorites.length === 9 && katalog.favorites[0] === null
        && katalog.favorites[1] && katalog.favorites[1].label === "frei"
        && katalog.favorites[2] === null,
        JSON.stringify(katalog.favorites.slice(0, 3)));

      const presets = normalizePresets({
        gut: { tokens: [{ type: "date" }, { type: "erfunden" }], counterStart: 5, counterDigits: 2 },
        kaputt: 3,
      });
      pruefe("unbekannte Bausteintypen werden verworfen",
        Object.keys(presets).length === 1 && presets.gut.tokens.length === 1 && presets.gut.tokens[0].type === "date",
        JSON.stringify(presets));
      pruefe("fehlende Zahlenwerte bekommen Standardwerte",
        presets.gut.counterStart === 5 && presets.gut.counterDigits === 2 && presets.gut.freeText === "");
    }

    /* ============================================================
       DATEINAMEN (Befund K3)
       ============================================================ */
    bereich("Dateinamen");

    pruefe("Leerzeichen werden zu Unterstrichen", sanitizeEventText("Zwei Wörter") === "Zwei_Wörter", sanitizeEventText("Zwei Wörter"));
    pruefe("Schrägstrich wird ersetzt", sanitizeEventText("Urlaub 2024/25") === "Urlaub_2024-25", sanitizeEventText("Urlaub 2024/25"));
    pruefe("weitere unzulässige Zeichen werden ersetzt", sanitizeEventText('a:b?c*d"e<f>g|h') === "a-b-c-d-e-f-g-h", sanitizeEventText('a:b?c*d"e<f>g|h'));
    pruefe("Rückwärtsschrägstrich wird ersetzt", sanitizeEventText("a\\b") === "a-b", sanitizeEventText("a\\b"));
    pruefe("Bindestriche bleiben erhalten", sanitizeEventText("Nord-Süd") === "Nord-Süd", sanitizeEventText("Nord-Süd"));
    pruefe("Umlaute bleiben erhalten", sanitizeEventText("Öl Straße") === "Öl_Straße", sanitizeEventText("Öl Straße"));
    pruefe("führende Punkte werden entfernt", sanitizeFileBaseName("...versteckt") === "versteckt", sanitizeFileBaseName("...versteckt"));
    pruefe("abschließende Punkte werden entfernt", sanitizeFileBaseName("name...") === "name", sanitizeFileBaseName("name..."));
    pruefe("reservierte Gerätenamen werden entschärft", sanitizeFileBaseName("CON") === "_CON", sanitizeFileBaseName("CON"));
    pruefe("auch kleingeschriebene Gerätenamen", sanitizeFileBaseName("com1") === "_com1", sanitizeFileBaseName("com1"));
    pruefe("die Länge wird begrenzt", sanitizeFileBaseName("a".repeat(500)).length <= 200, sanitizeFileBaseName("a".repeat(500)).length);
    pruefe("ein leerer Name bleibt leer (Aufrufer setzt den Ersatznamen)", sanitizeFileBaseName("...") === "", JSON.stringify(sanitizeFileBaseName("...")));

    /* ============================================================
       ÜBERSCHREIBSCHUTZ (Befund K1)
       ============================================================ */
    bereich("Überschreibschutz");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("k1");
      quelle.files.set("neu.jpg", datei);

      const bestand = new File([new Uint8Array([1, 2, 3, 4, 5])], "Fest.jpg");
      ziel.files.set("Fest.jpg", bestand);

      const eintrag = fotoEintrag("neu.jpg", datei, []);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);
      await durchgang([eintrag], quelle, ziel, "Fest");

      pruefe("die vorhandene Zieldatei bleibt unverändert",
        ziel.files.get("Fest.jpg") === bestand && ziel.files.get("Fest.jpg").size === 5,
        ziel.files.get("Fest.jpg").size + " Bytes");
      pruefe("es wird auf einen freien Namen ausgewichen", ziel.files.has("Fest_1.jpg"), ziel.namen().join(","));
      pruefe("das Verschieben gelingt trotzdem", !quelle.files.has("neu.jpg"));
    }

    {
      // Zwei Fotos im selben Durchgang, die auf denselben Namen zielen: der zweite
      // darf den ersten nicht überschreiben, obwohl beide vor dem Schreiben geprüft werden.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("a");
      const b = await jpegDatei("bb");
      quelle.files.set("a.jpg", a);
      quelle.files.set("b.jpg", b);
      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      const e2 = fotoEintrag("b.jpg", b, []); e2.action = "move";
      namensschema([{ type: "event" }]);
      await durchgang([e1, e2], quelle, ziel, "Gleich");

      pruefe("zwei gleichnamige Ziele im selben Durchgang kollidieren nicht",
        ziel.files.has("Gleich.jpg") && ziel.files.has("Gleich_1.jpg"), ziel.namen().join(","));
      pruefe("beide Quelldateien wurden verschoben", quelle.files.size === 0, quelle.namen().join(","));
    }

    {
      // Auch eine fremde .xmp-Datei blockiert den Namen - sonst überschreibt die
      // eigene Sidecar-Datei eine bestehende.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("k1b");
      quelle.files.set("n.jpg", datei);
      ziel.files.set("Fest.xmp", new File([new Uint8Array([9])], "Fest.xmp"));

      const eintrag = fotoEintrag("n.jpg", datei, ["tag"]);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);
      await durchgang([eintrag], quelle, ziel, "Fest");

      pruefe("eine fremde Sidecar-Datei bleibt unverändert", ziel.files.get("Fest.xmp").size === 1, ziel.files.get("Fest.xmp").size);
      pruefe("die eigenen Dateien weichen aus",
        ziel.files.has("Fest_1.jpg") && ziel.files.has("Fest_1.xmp"), ziel.namen().join(","));
    }

    /* ============================================================
       SIDECAR-FALLBACK (Befund K2)
       ============================================================ */
    bereich("Sidecar-Fallback");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("k2");
      quelle.files.set("b.jpg", datei);
      const eintrag = fotoEintrag("b.jpg", datei, ["Urlaub"]);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);

      // Direkte Einbettung erzwungen scheitern lassen -> der Code muss auf die
      // reine Sidecar-Variante zurückfallen UND den Durchgang abschließen.
      window.writeKeywordsToJpeg = () => { throw new Error("Einbettung simuliert fehlgeschlagen"); };
      try {
        await durchgang([eintrag], quelle, ziel, "Ohne");
      } finally {
        window.writeKeywordsToJpeg = echtesWriteKeywordsToJpeg;
      }

      pruefe("Foto und Sidecar liegen im Ziel",
        ziel.files.has("Ohne.jpg") && ziel.files.has("Ohne.xmp"), ziel.namen().join(","));
      pruefe("die Quelldatei wurde gelöscht", !quelle.files.has("b.jpg"));
      if (ziel.files.has("Ohne.xmp")) {
        const inhalt = await ziel.files.get("Ohne.xmp").text();
        pruefe("die Sidecar-Datei enthält das Stichwort",
          parseXmpData(inhalt).keywords.join(",") === "Urlaub", parseXmpData(inhalt).keywords.join(","));
      }
      if (ziel.files.has("Ohne.jpg")) {
        const bytes = new Uint8Array(await ziel.files.get("Ohne.jpg").arrayBuffer());
        pruefe("die Zieldatei ist die unveränderte Originaldatei",
          bytes.length === datei.size, bytes.length + " vs " + datei.size);
      }
    }

    {
      // Gegenprobe: eine beschädigte Sidecar-Datei muss das Löschen der Quelle verhindern.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("sc");
      quelle.files.set("s.jpg", datei);
      const eintrag = fotoEintrag("s.jpg", datei, ["Berg"]);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);

      const echtesBuild = window.buildXmpPacket;
      let ersterAufruf = true;
      window.buildXmpPacket = function (keywords, description) {
        // Nur die Sidecar-Datei verfälschen, nicht das eingebettete Paket.
        const ergebnis = echtesBuild.call(this, keywords, description);
        if (ersterAufruf) { ersterAufruf = false; return ergebnis; }
        return echtesBuild.call(this, ["falsch"], description);
      };
      try {
        await durchgang([eintrag], quelle, ziel, "Prüf");
      } finally {
        window.buildXmpPacket = echtesBuild;
      }

      pruefe("eine falsche Sidecar-Datei verhindert das Löschen der Quelle",
        quelle.files.has("s.jpg"), quelle.namen().join(","));
    }

    /* ============================================================
       LANGE STICHWORTE (Befund M3)
       ============================================================ */
    bereich("Lange Stichworte");

    {
      const lang = "A".repeat(80); // über der IPTC-Grenze von 64 Byte
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("m3");
      quelle.files.set("lang.jpg", datei);
      const eintrag = fotoEintrag("lang.jpg", datei, [lang]);
      eintrag.action = "move";
      namensschema([{ type: "text" }], "Lang");
      await durchgang([eintrag], quelle, ziel, "");

      pruefe("ein überlanges Stichwort verhindert das Verschieben nicht",
        ziel.files.has("Lang.jpg") && !quelle.files.has("lang.jpg"), ziel.namen().join(","));
      if (ziel.files.has("Lang.jpg")) {
        const bytes = new Uint8Array(await ziel.files.get("Lang.jpg").arrayBuffer());
        pruefe("die Konsistenzprüfung besteht", verifyWrittenJpegKeywords(bytes, [lang], null) === true);
      }
    }

    /* ============================================================
       EREIGNISTEXT IM ABLAUF (Befund K3)
       ============================================================ */
    bereich("Ereignistext");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("k3");
      quelle.files.set("a.jpg", datei);
      const eintrag = fotoEintrag("a.jpg", datei, []);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);
      await durchgang([eintrag], quelle, ziel, "Urlaub 2024/25");

      pruefe("ein Schrägstrich im Ereignis lässt den Durchgang nicht scheitern",
        ziel.files.has("Urlaub_2024-25.jpg") && !quelle.files.has("a.jpg"), ziel.namen().join(","));
      if (ziel.files.has("Urlaub_2024-25.xmp")) {
        const inhalt = await ziel.files.get("Urlaub_2024-25.xmp").text();
        pruefe("die Beschreibung bleibt im Metadatenfeld unverändert lesbar",
          parseXmpData(inhalt).description === "Urlaub 2024/25", parseXmpData(inhalt).description);
      }
    }

    /* ============================================================
       LÖSCHABFRAGE (Befund M5)
       ============================================================ */
    bereich("Löschabfrage");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("m5");
      quelle.files.set("weg.jpg", datei);

      const abgelehnt = fotoEintrag("weg.jpg", datei, []);
      abgelehnt.action = "delete";
      window.confirm = () => false;
      await durchgang([abgelehnt], quelle, ziel, "");
      pruefe("bei Ablehnung wird nichts gelöscht", quelle.files.has("weg.jpg"), quelle.namen().join(","));

      const bestaetigt = fotoEintrag("weg.jpg", datei, []);
      bestaetigt.action = "delete";
      window.confirm = () => true;
      await durchgang([bestaetigt], quelle, ziel, "");
      pruefe("bei Bestätigung wird gelöscht", !quelle.files.has("weg.jpg"), quelle.namen().join(","));
    }

    {
      // Ein reiner Verschiebe-Durchgang darf NICHT nachfragen.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("nofrage");
      quelle.files.set("v.jpg", datei);
      const eintrag = fotoEintrag("v.jpg", datei, []);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);

      let gefragt = false;
      window.confirm = () => { gefragt = true; return true; };
      await durchgang([eintrag], quelle, ziel, "Ohne");
      window.confirm = () => true;
      pruefe("ohne Löschungen wird nicht nachgefragt", gefragt === false);
    }

    /* ============================================================
       FEHLERZUORDNUNG (Befund M7)
       ============================================================ */
    bereich("Fehlerzuordnung");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("1");
      const b = await jpegDatei("22");
      // Der Name der ersten Datei ist Präfix der zweiten - genau der Fall, den die
      // frühere Zuordnung über Textvergleich verwechselt hat.
      quelle.files.set("foto.jpg", a);
      quelle.files.set("foto.jpg.jpg", b);
      quelle.loeschenSchlaegtFehl.add("foto.jpg");

      const e1 = fotoEintrag("foto.jpg", a, []); e1.action = "move";
      const e2 = fotoEintrag("foto.jpg.jpg", b, []); e2.action = "move";
      namensschema([{ type: "counter" }]);
      await durchgang([e1, e2], quelle, ziel, "");

      const verbleibend = state.photos.map((p) => p.name);
      pruefe("nur das tatsächlich gescheiterte Foto bleibt in der Liste",
        verbleibend.length === 1 && verbleibend[0] === "foto.jpg", verbleibend.join(","));
      pruefe("die Aktion des gescheiterten Fotos wird zurückgesetzt",
        state.photos[0] && state.photos[0].action === "none", state.photos[0] && state.photos[0].action);
    }

    /* ============================================================
       SITZUNG ÜBER EINEN RELOAD (F4)
       ============================================================ */
    bereich("Sitzung fortsetzen");

    {
      const datei = await jpegDatei("s");
      const fotos = [
        fotoEintrag("a.jpg", datei, []),
        fotoEintrag("b.jpg", datei, [], "2026"),
        fotoEintrag("c.jpg", datei, []),
      ];
      const ergebnis = applySavedMarks(fotos, [
        { relPath: "", name: "a.jpg", action: "move", assignedKeywords: ["Berg"] },
        { relPath: "2026", name: "b.jpg", action: "delete", assignedKeywords: [] },
        { relPath: "", name: "weg.jpg", action: "move", assignedKeywords: [] },
      ]);

      pruefe("Markierungen werden übernommen",
        fotos[0].action === "move" && fotos[1].action === "delete", fotos.map((f) => f.action).join(","));
      pruefe("Stichworte werden übernommen", fotos[0].assignedKeywords.join(",") === "Berg");
      pruefe("nicht gesicherte Fotos bleiben unmarkiert", fotos[2].action === "none");
      pruefe("verschwundene Fotos werden gezählt, nicht übertragen",
        ergebnis.uebernommen === 2 && ergebnis.verschwunden === 1,
        ergebnis.uebernommen + "/" + ergebnis.verschwunden);
    }

    {
      // Gleiche Dateinamen in verschiedenen Unterordnern dürfen sich nicht
      // gegenseitig die Markierung stehlen.
      const datei = await jpegDatei("s2");
      const fotos = [
        fotoEintrag("bild.jpg", datei, []),
        fotoEintrag("bild.jpg", datei, [], "2026"),
      ];
      applySavedMarks(fotos, [{ relPath: "2026", name: "bild.jpg", action: "delete", assignedKeywords: [] }]);
      pruefe("die Zuordnung berücksichtigt den Unterordner",
        fotos[0].action === "none" && fotos[1].action === "delete",
        fotos.map((f) => f.relPath + ":" + f.action).join(","));
    }

    {
      // Der Schlüssel muss auch dann eindeutig sein, wenn Ordner- und Dateiname
      // dieselbe Zeichenfolge unterschiedlich aufteilen.
      pruefe("der Zuordnungsschlüssel ist eindeutig",
        photoSessionKey("a", "b/c") !== photoSessionKey("a/b", "c"),
        photoSessionKey("a", "b/c") + " vs " + photoSessionKey("a/b", "c"));
    }

    {
      // Fremddaten: ein gesicherter Stand kann aus einer älteren Version stammen.
      const datei = await jpegDatei("s3");
      const fotos = [fotoEintrag("a.jpg", datei, [])];
      applySavedMarks(fotos, [
        { relPath: "", name: "a.jpg", action: "unsinn", assignedKeywords: ["gut", "", 42, null] },
      ]);
      pruefe("eine unbekannte Aktion wird nicht übernommen", fotos[0].action === "none", fotos[0].action);
      pruefe("unbrauchbare Stichworte werden aussortiert",
        fotos[0].assignedKeywords.join(",") === "gut", fotos[0].assignedKeywords.join(","));
    }

    {
      // Der Weg durch IndexedDB: sichern, lesen, verwerfen.
      await saveSessionState({ gesichertAm: 123, markierungen: [{ relPath: "", name: "x.jpg", action: "move" }] });
      const gelesen = await loadSessionState();
      pruefe("der gesicherte Stand lässt sich zurücklesen",
        gelesen && gelesen.gesichertAm === 123 && gelesen.markierungen.length === 1,
        gelesen && gelesen.gesichertAm);

      await clearSessionState();
      pruefe("nach dem Verwerfen ist nichts mehr gespeichert", (await loadSessionState()) === null);
    }

    /* ============================================================
       PROTOKOLL UND RÜCKGÄNGIG (F5)
       ============================================================ */
    bereich("Protokoll");

    {
      const quelle = new AttrappenVerzeichnis("Karte");
      const ziel = new AttrappenVerzeichnis("Archiv");
      const a = await jpegDatei("prot1");
      const b = await jpegDatei("prot2");
      quelle.files.set("a.jpg", a);
      quelle.files.set("b.jpg", b);

      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      const e2 = fotoEintrag("b.jpg", b, []); e2.action = "delete";
      namensschema([{ type: "counter" }]);
      await durchgang([e1, e2], quelle, ziel, "");

      pruefe("eine Protokolldatei wird angelegt", ziel.files.has(PROTOCOL_FILE_NAME), ziel.namen().join(","));
      const text = ziel.files.has(PROTOCOL_FILE_NAME) ? await ziel.files.get(PROTOCOL_FILE_NAME).text() : "";
      pruefe("das Protokoll nennt Quelle und Ziel",
        text.includes("Quelle: Karte") && text.includes("Ziel:   Archiv"));
      pruefe("das Protokoll nennt die Verschiebung mit Quell- und Zielnamen",
        text.includes("a.jpg  ->  001.jpg"), text.split("\n").find((z) => z.includes("->")));
      pruefe("das Protokoll nennt die Löschung", text.includes("b.jpg") && text.includes("Geloescht (1)"));
      pruefe("das Protokoll weist auf den fehlenden Papierkorb hin",
        text.includes("kein Papierkorb"));

      // Ein zweiter Durchgang darf den ersten nicht überschreiben - das Protokoll
      // ist ein fortgeschriebener Bestand, keine Momentaufnahme.
      const c = await jpegDatei("prot3");
      quelle.files.set("c.jpg", c);
      const e3 = fotoEintrag("c.jpg", c, []); e3.action = "move";
      await durchgang([e3], quelle, ziel, "");
      const text2 = await ziel.files.get(PROTOCOL_FILE_NAME).text();
      pruefe("ein zweiter Durchgang wird angehängt, nicht ersetzt",
        (text2.match(/=== Durchgang /g) || []).length === 2,
        (text2.match(/=== Durchgang /g) || []).length);
    }

    bereich("Rückgängig");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("u1");
      const originalBytes = new Uint8Array(await a.arrayBuffer());
      quelle.files.set("original.jpg", a);

      const e1 = fotoEintrag("original.jpg", a, ["Berg"]); e1.action = "move";
      namensschema([{ type: "counter" }]);
      await durchgang([e1], quelle, ziel, "Tour");

      pruefe("vor dem Rückgängig ist die Quelle leer", !quelle.files.has("original.jpg"));
      pruefe("ein Rückgängig wird angeboten",
        state.lastRunLog && state.lastRunLog.verschoben.length === 1);

      await undoLastRun();

      pruefe("die Datei liegt wieder im Quellordner", quelle.files.has("original.jpg"), quelle.namen().join(","));
      pruefe("die Zieldatei ist entfernt", !ziel.files.has("001.jpg"), ziel.fotoNamen().join(","));
      pruefe("auch die Sidecar-Datei ist entfernt", !ziel.files.has("001.xmp"), ziel.fotoNamen().join(","));

      if (quelle.files.has("original.jpg")) {
        const zurueck = new Uint8Array(await quelle.files.get("original.jpg").arrayBuffer());
        const vorher = getComparableImageBytes(originalBytes, "jpg");
        const nachher = getComparableImageBytes(zurueck, "jpg");
        let gleich = vorher.length === nachher.length;
        if (gleich) for (let i = 0; i < vorher.length; i++) if (vorher[i] !== nachher[i]) { gleich = false; break; }
        pruefe("die zurückgeholten Bilddaten sind unverändert", gleich, vorher.length + " vs " + nachher.length);
      }

      pruefe("das Foto ist wieder in der Liste",
        state.photos.some((p) => p.name === "original.jpg"), state.photos.map((p) => p.name).join(","));
      pruefe("die zugewiesenen Stichworte bleiben erhalten",
        state.photos.some((p) => p.name === "original.jpg" && p.assignedKeywords.join(",") === "Berg"));
      pruefe("ein zweites Rückgängig ist ausgeschlossen", state.lastRunLog.zurueckgenommen === true);
    }

    {
      // Der wichtigste Fall: schlägt die Prüfung der zurückgeschriebenen Datei
      // fehl, darf die Zieldatei NICHT gelöscht werden. Lieber zweimal vorhanden
      // als keinmal.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("u2");
      quelle.files.set("original.jpg", a);

      const e1 = fotoEintrag("original.jpg", a, []); e1.action = "move";
      namensschema([{ type: "counter" }]);
      await durchgang([e1], quelle, ziel, "");

      // Beim Zurückschreiben landet absichtlich ein zu kurzer Inhalt im Quellordner.
      const echtesGetFileHandle = quelle.getFileHandle;
      quelle.getFileHandle = async function (name, options) {
        const handle = await echtesGetFileHandle.call(this, name, options);
        const verzeichnis = this;
        return {
          getFile: handle.getFile,
          async createWritable() {
            return {
              async write() { /* verschluckt den Inhalt */ },
              async close() { verzeichnis.files.set(name, new File([new Uint8Array(3)], name)); },
            };
          },
        };
      };
      await undoLastRun();
      quelle.getFileHandle = echtesGetFileHandle;

      pruefe("bei fehlgeschlagener Prüfung bleibt die Zieldatei liegen",
        ziel.files.has("001.jpg"), ziel.fotoNamen().join(","));
    }

    /* ============================================================
       TROCKENLAUF (F2)
       ============================================================ */
    bereich("Trockenlauf");

    {
      const merke = currentSubfolderMode;
      currentSubfolderMode = "year";

      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("p1");
      const b = await jpegDatei("p2");
      quelle.files.set("a.jpg", a);
      quelle.files.set("b.jpg", b);

      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      const e2 = fotoEintrag("b.jpg", b, []); e2.action = "delete";
      e1.captureDate = new Date(2026, 2, 4);
      namensschema([{ type: "counter" }]);

      state.photos = [e1, e2];
      state.sourceDirHandle = quelle;
      state.targetDirHandle = ziel;
      const plan = await planActions("");

      pruefe("der Plan trennt Verschieben und Löschen",
        plan.moves.length === 1 && plan.deletes.length === 1,
        plan.moves.length + "/" + plan.deletes.length);
      pruefe("der Plan nennt Zielordner und Zielnamen",
        plan.moves[0].dirLabel === "2026" && plan.moves[0].targetName === "001.jpg",
        plan.moves[0].dirLabel + "/" + plan.moves[0].targetName);

      // Das entscheidende Merkmal eines Trockenlaufs: er verändert nichts.
      pruefe("der Trockenlauf legt keine Ordner an",
        ziel.unterordner.size === 0, [...ziel.unterordner.keys()].join(","));
      pruefe("der Trockenlauf schreibt keine Dateien",
        ziel.namen().length === 0, ziel.namen().join(","));
      pruefe("der Trockenlauf löscht nichts",
        quelle.namen().join(",") === "a.jpg,b.jpg", quelle.namen().join(","));

      currentSubfolderMode = merke;
    }

    {
      // Belegte Namen müssen in der Vorschau als solche erkennbar sein - sonst
      // wundert man sich hinterher über die _1-Suffixe.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("k");
      quelle.files.set("a.jpg", a);
      ziel.files.set("bild.jpg", new File(["x"], "bild.jpg"));

      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      namensschema([{ type: "text" }], "bild");
      state.photos = [e1];
      state.sourceDirHandle = quelle;
      state.targetDirHandle = ziel;

      const plan = await planActions("");
      pruefe("ein belegter Zielname wird im Plan markiert",
        plan.evadedCount === 1 && plan.moves[0].evaded === true && plan.moves[0].targetName === "bild_1.jpg",
        plan.moves[0].targetName);
    }

    {
      // Der Plan darf die Namensvergabe des echten Durchgangs nicht vorbelegen:
      // sonst bekäme jedes Foto ein Suffix, obwohl der Name frei ist.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("v");
      quelle.files.set("a.jpg", a);

      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      namensschema([{ type: "text" }], "bild");
      state.photos = [e1];
      state.sourceDirHandle = quelle;
      state.targetDirHandle = ziel;

      const plan = await planActions("");
      await durchgang([e1], quelle, ziel, "");
      pruefe("nach dem Trockenlauf trägt die Datei den vorhergesagten Namen",
        ziel.files.has(plan.moves[0].targetName) && plan.moves[0].targetName === "bild.jpg",
        ziel.namen().join(","));
    }

    /* ============================================================
       ZIELUNTERORDNER (F3)
       ============================================================ */
    bereich("Zielunterordner");

    {
      const merke = currentSubfolderMode;
      const ctx = { date: new Date(2026, 7, 12), event: "Sommer Urlaub" };

      currentSubfolderMode = "none";
      pruefe("ohne Gliederung entstehen keine Segmente",
        buildTargetSubfolderSegments(ctx).length === 0);

      currentSubfolderMode = "year";
      pruefe("Jahr", subfolderPathLabel(buildTargetSubfolderSegments(ctx)) === "2026",
        subfolderPathLabel(buildTargetSubfolderSegments(ctx)));

      currentSubfolderMode = "yearMonth";
      pruefe("Jahr / Jahr-Monat", subfolderPathLabel(buildTargetSubfolderSegments(ctx)) === "2026/2026-08",
        subfolderPathLabel(buildTargetSubfolderSegments(ctx)));

      currentSubfolderMode = "yearMonthDay";
      pruefe("bis zum Tag", subfolderPathLabel(buildTargetSubfolderSegments(ctx)) === "2026/2026-08/2026-08-12",
        subfolderPathLabel(buildTargetSubfolderSegments(ctx)));

      currentSubfolderMode = "yearEvent";
      pruefe("Jahr / Ereignis", subfolderPathLabel(buildTargetSubfolderSegments(ctx)) === "2026/Sommer_Urlaub",
        subfolderPathLabel(buildTargetSubfolderSegments(ctx)));

      // Der gefährliche Fall: ein Schrägstrich im Ereignistext würde sonst eine
      // zusätzliche Ordnerebene erzeugen, und getDirectoryHandle() weist jeden
      // Namen mit Pfadseparator ohnehin zurück.
      currentSubfolderMode = "event";
      const boese = subfolderPathLabel(buildTargetSubfolderSegments({ date: ctx.date, event: "Urlaub 2024/25" }));
      pruefe("ein Schrägstrich im Ereignis erzeugt keine zusätzliche Ebene",
        boese === "Urlaub_2024-25", boese);

      // Ohne Ereignistext bliebe ein Ordner ohne Namen übrig.
      const leer = buildTargetSubfolderSegments({ date: ctx.date, event: "" });
      pruefe("ein leeres Ereignis erzeugt keinen namenlosen Ordner", leer.length === 0, leer.join("/"));

      currentSubfolderMode = merke;
    }

    {
      // Der ganze Weg: Fotos zweier Monate landen in getrennten Unterordnern.
      const merke = currentSubfolderMode;
      currentSubfolderMode = "yearMonth";

      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("mai");
      const b = await jpegDatei("jun");
      quelle.files.set("a.jpg", a);
      quelle.files.set("b.jpg", b);

      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      const e2 = fotoEintrag("b.jpg", b, []); e2.action = "move";
      e1.captureDate = new Date(2026, 4, 3);
      e2.captureDate = new Date(2026, 5, 9);
      namensschema([{ type: "counter" }]);
      await durchgang([e1, e2], quelle, ziel, "");

      const mai = ziel.unterordner.get("2026") && ziel.unterordner.get("2026").unterordner.get("2026-05");
      const juni = ziel.unterordner.get("2026") && ziel.unterordner.get("2026").unterordner.get("2026-06");
      pruefe("die Zielordner werden angelegt", !!mai && !!juni);
      pruefe("jedes Foto landet im Ordner seines Aufnahmemonats",
        mai && juni && mai.namen().join(",") === "001.jpg" && juni.namen().join(",") === "002.jpg",
        (mai && mai.namen().join(",")) + " | " + (juni && juni.namen().join(",")));
      pruefe("im Wurzelverzeichnis des Ziels liegt kein Foto", ziel.fotoNamen().length === 0, ziel.fotoNamen().join(","));

      currentSubfolderMode = merke;
    }

    {
      // Namen sind pro Ordner belegt, nicht global: derselbe Name in zwei
      // Monatsordnern darf kein "_1"-Suffix auslösen.
      const merke = currentSubfolderMode;
      currentSubfolderMode = "year";

      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const a = await jpegDatei("a");
      const b = await jpegDatei("b");
      quelle.files.set("a.jpg", a);
      quelle.files.set("b.jpg", b);

      const e1 = fotoEintrag("a.jpg", a, []); e1.action = "move";
      const e2 = fotoEintrag("b.jpg", b, []); e2.action = "move";
      e1.captureDate = new Date(2025, 0, 1);
      e2.captureDate = new Date(2026, 0, 1);
      namensschema([{ type: "text" }], "bild");
      await durchgang([e1, e2], quelle, ziel, "");

      const j25 = ziel.unterordner.get("2025");
      const j26 = ziel.unterordner.get("2026");
      pruefe("derselbe Name in verschiedenen Ordnern bleibt ohne Suffix",
        j25 && j26 && j25.files.has("bild.jpg") && j26.files.has("bild.jpg"),
        (j25 && j25.namen().join(",")) + " | " + (j26 && j26.namen().join(",")));

      currentSubfolderMode = merke;
    }

    /* ============================================================
       RAW-VORSCHAU (F7)
       ============================================================ */
    bereich("RAW-Vorschau");

    {
      // Eine synthetische TIFF-basierte RAW-Datei mit einem ECHTEN JPEG darin.
      // Der Unit-Test prüft, dass die Offsets richtig gelesen werden; hier geht
      // es um den Schritt danach: aus Offset und Länge muss ein Blob werden,
      // den der Browser tatsächlich decodieren kann.
      const jpeg = await jpegDatei("raw");
      const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
      const jpegAt = 4096;
      const roh = new Uint8Array(jpegAt + jpegBytes.length + 16);

      const le = (wert) => [wert & 0xff, (wert >> 8) & 0xff, (wert >> 16) & 0xff, (wert >>> 24) & 0xff];
      roh.set([0x49, 0x49, 42, 0x00], 0); // "II", Magic 42
      roh.set(le(8), 4); // erstes IFD bei Offset 8
      roh.set([2, 0], 8); // zwei Einträge
      roh.set([0x01, 0x02, 4, 0, ...le(1), ...le(jpegAt)], 10); // JpegInterchangeFormat
      roh.set([0x02, 0x02, 4, 0, ...le(1), ...le(jpegBytes.length)], 22); // ...Length
      roh.set(le(0), 34); // kein weiteres IFD
      roh.set(jpegBytes, jpegAt);

      const rawDatei = new File([roh], "bild.dng");
      const vorschau = await extractRawPreviewBlob(rawDatei);
      pruefe("aus einer RAW-Datei wird ein Vorschau-Blob geschnitten",
        vorschau instanceof Blob && vorschau.size === jpegBytes.length,
        vorschau && vorschau.size);

      if (vorschau) {
        const url = URL.createObjectURL(vorschau);
        const masse = await new Promise((r) => {
          const img = new Image();
          img.onload = () => r(img.naturalWidth + "x" + img.naturalHeight);
          img.onerror = () => r(null);
          img.src = url;
        });
        URL.revokeObjectURL(url);
        pruefe("die Vorschau ist ein decodierbares Bild", masse === "48x32", masse);
      }
    }

    {
      // Ohne Struktur greift die Byte-Suche: dasselbe JPEG, aber ohne TIFF-Kopf.
      const jpeg = await jpegDatei("scan");
      const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
      const roh = new Uint8Array(2048 + jpegBytes.length + 8);
      roh.set(jpegBytes, 2048);

      const vorschau = await extractRawPreviewBlob(new File([roh], "unbekannt.orf"));
      pruefe("ohne Struktur findet die Byte-Suche die Vorschau",
        vorschau instanceof Blob && vorschau.size === jpegBytes.length, vorschau && vorschau.size);
    }

    {
      // Eine Datei ohne jedes Bild darf null liefern, nicht werfen - sonst
      // scheitert das Laden der ganzen Kachel.
      const leer = new File([new Uint8Array(4096)], "leer.cr2");
      let fehler = null;
      let ergebnis;
      try { ergebnis = await extractRawPreviewBlob(leer); } catch (e) { fehler = e; }
      pruefe("eine RAW-Datei ohne Vorschau liefert null statt eines Fehlers",
        fehler === null && ergebnis === null, fehler ? fehler.message : String(ergebnis));
    }

    /* ============================================================
       VORHANDENE STICHWORTE (F8)
       ============================================================ */
    bereich("Vorhandene Stichworte");

    {
      // Round-Trip: ein JPEG mit eingebetteten Metadaten muss beim Einlesen
      // genau diese Stichworte wieder hergeben.
      const datei = await jpegDatei("meta");
      const roh = new Uint8Array(await datei.arrayBuffer());
      const deps = { buildIptcIimBlock, buildIrbForIptc, parseIrbs, buildXmpPacket };
      const beschrieben = writeKeywordsToJpeg(roh, ["Alpen", "Winter"], deps, "Skiurlaub");

      const gelesen = readExistingKeywords(beschrieben);
      pruefe("eingebettete Stichworte werden gefunden",
        gelesen.keywords.join(",") === "Alpen,Winter", gelesen.keywords.join(","));
      pruefe("die eingebettete Beschreibung wird gefunden",
        gelesen.description === "Skiurlaub", gelesen.description);

      const ohne = readExistingKeywords(roh);
      pruefe("ein Foto ohne Metadaten liefert eine leere Liste",
        ohne.keywords.length === 0 && ohne.description === null, ohne.keywords.length + "/" + ohne.description);

      // Kein Absturz bei Datenmüll: das Einlesen darf nicht am ersten kaputten
      // Foto einer Speicherkarte scheitern.
      const muell = readExistingKeywords(new Uint8Array([1, 2, 3, 4, 5]));
      pruefe("unlesbare Daten führen zu einer leeren Liste statt zu einem Fehler",
        muell.keywords.length === 0);
    }

    {
      // XMP hat Vorrang, weil IPTC auf 64 Byte kürzt.
      const datei = await jpegDatei("lang");
      const roh = new Uint8Array(await datei.arrayBuffer());
      const deps = { buildIptcIimBlock, buildIrbForIptc, parseIrbs, buildXmpPacket };
      const langes = "L" + "a".repeat(90);
      const beschrieben = writeKeywordsToJpeg(roh, [langes], deps, null);
      const gelesen = readExistingKeywords(beschrieben);
      pruefe("bei langen Stichworten gewinnt die ungekürzte XMP-Fassung",
        gelesen.keywords[0] === langes, gelesen.keywords[0] && gelesen.keywords[0].length);
    }

    {
      // Die Zusammenstellung für die Oberfläche: Häufigkeit über die Auswahl.
      const datei = await jpegDatei("z");
      const a = fotoEintrag("a.jpg", datei, []);
      const b = fotoEintrag("b.jpg", datei, ["Berg"]);
      a.existingKeywords = ["Berg", "See"];
      b.existingKeywords = ["Berg"];
      const vorher = state.photos;
      state.photos = [a, b];
      const gefunden = collectExistingKeywords([0, 1]);
      state.photos = vorher;

      pruefe("gefundene Stichworte werden nach Häufigkeit sortiert",
        gefunden.map((f) => f.label + ":" + f.count).join(",") === "Berg:2,See:1",
        gefunden.map((f) => f.label + ":" + f.count).join(","));
      pruefe("bereits vollständig zugewiesene werden als solche erkannt",
        gefunden[0].assignedToAll === false && gefunden[1].assignedToAll === false);
    }

    /* ============================================================
       UNTERORDNER DER QUELLE (F6)
       ============================================================ */
    bereich("Unterordner der Quelle");

    {
      // Der Kern von F6: gelöscht werden muss im ENTHALTENDEN Ordner. Würde
      // weiterhin state.sourceDirHandle verwendet, bliebe die Quelldatei im
      // Unterordner liegen - und wäre gleichzeitig schon ins Ziel kopiert.
      const quelle = new AttrappenVerzeichnis("quelle");
      const unter = new AttrappenVerzeichnis("2024");
      const ziel = new AttrappenVerzeichnis("ziel");
      const oben = await jpegDatei("o");
      const unten = await jpegDatei("u");
      quelle.files.set("oben.jpg", oben);
      unter.files.set("unten.jpg", unten);

      const e1 = fotoEintrag("oben.jpg", oben, []); e1.action = "move";
      const e2 = fotoEintrag("unten.jpg", unten, [], "2024"); e2.action = "move";
      e2.dirHandle = unter;
      namensschema([{ type: "counter" }]);
      await durchgang([e1, e2], quelle, ziel, "");

      pruefe("die Datei aus dem Unterordner wird dort gelöscht",
        !unter.files.has("unten.jpg"), unter.namen().join(","));
      pruefe("die Datei aus der obersten Ebene wird dort gelöscht",
        !quelle.files.has("oben.jpg"), quelle.namen().join(","));
      pruefe("beide Fotos liegen im Ziel", ziel.fotoNamen().join(",") === "001.jpg,002.jpg", ziel.fotoNamen().join(","));
    }

    {
      // Der Anzeigename trägt den Pfad, sonst sind gleichnamige Dateien aus
      // verschiedenen Unterordnern in der Oberfläche nicht unterscheidbar.
      const datei = await jpegDatei("n");
      const ohne = fotoEintrag("bild.jpg", datei, []);
      const mit = fotoEintrag("bild.jpg", datei, [], "2024/Mai");
      pruefe("ohne Unterordner bleibt der reine Dateiname",
        photoDisplayName(ohne) === "bild.jpg", photoDisplayName(ohne));
      pruefe("mit Unterordner wird der Pfad vorangestellt",
        photoDisplayName(mit) === "2024/Mai/bild.jpg", photoDisplayName(mit));
    }

    {
      // Einlesen über Attrappen: Unterordner nur auf Wunsch, versteckte nie.
      const wurzel = new AttrappenVerzeichnis("wurzel");
      const jahr = new AttrappenVerzeichnis("2024");
      const versteckt = new AttrappenVerzeichnis(".trash");
      wurzel.files.set("a.jpg", new File([], "a.jpg"));
      wurzel.files.set("liesmich.txt", new File([], "liesmich.txt"));
      jahr.files.set("b.jpg", new File([], "b.jpg"));
      versteckt.files.set("c.jpg", new File([], "c.jpg"));
      wurzel.unterordner.set("2024", jahr);
      wurzel.unterordner.set(".trash", versteckt);

      const flach = [];
      await collectPhotoEntries(wurzel, "", false, 0, flach);
      pruefe("ohne Schalter bleibt es bei der obersten Ebene",
        flach.map((e) => photoDisplayName(e)).join(",") === "a.jpg", flach.map((e) => photoDisplayName(e)).join(","));

      const tief = [];
      await collectPhotoEntries(wurzel, "", true, 0, tief);
      pruefe("mit Schalter kommen Unterordner dazu, versteckte nicht",
        tief.map((e) => photoDisplayName(e)).sort().join(",") === "2024/b.jpg,a.jpg",
        tief.map((e) => photoDisplayName(e)).sort().join(","));
      pruefe("der enthaltende Ordner wird am Eintrag vermerkt",
        tief.every((e) => e.dirHandle === (e.relPath === "2024" ? jahr : wurzel)));
    }

    /* ============================================================
       VORSCHAU-CACHE (Befund M6)
       ============================================================ */
    bereich("Vorschau-Cache");

    {
      largePreviewLru.length = 0;
      const eintraege = [];
      for (let i = 0; i < LARGE_PREVIEW_CACHE_SIZE + 5; i++) {
        eintraege.push({ largePreviewUrl: "nicht-blob:" + i, fullResUrl: null });
      }
      eintraege.forEach((e) => touchLargePreview(e));

      const gehalten = eintraege.filter((e) => e.largePreviewUrl !== null).length;
      pruefe("der Cache bleibt begrenzt",
        gehalten === LARGE_PREVIEW_CACHE_SIZE && largePreviewLru.length === LARGE_PREVIEW_CACHE_SIZE,
        gehalten + " von " + eintraege.length);
      pruefe("das zuletzt benutzte Foto wird nicht verdrängt",
        eintraege[eintraege.length - 1].largePreviewUrl !== null);
      pruefe("das älteste Foto wird freigegeben", eintraege[0].largePreviewUrl === null);

      // Erneutes Anfassen schiebt einen Eintrag ans Ende und schützt ihn.
      const zweitAeltester = eintraege[6];
      touchLargePreview(zweitAeltester);
      for (let i = 0; i < 5; i++) touchLargePreview({ largePreviewUrl: "nicht-blob:neu" + i, fullResUrl: null });
      pruefe("erneut benutzte Fotos rutschen ans Ende der Liste", zweitAeltester.largePreviewUrl !== null);
      largePreviewLru.length = 0;
    }

    /* ============================================================
       REGRESSION: DER NORMALE VERSCHIEBEVORGANG
       ============================================================ */
    bereich("Regression Verschieben");

    {
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("reg");
      const originalBytes = new Uint8Array(await datei.arrayBuffer());
      quelle.files.set("r.jpg", datei);

      const eintrag = fotoEintrag("r.jpg", datei, ["Berg", "Schnee"]);
      eintrag.action = "move";
      namensschema([{ type: "date" }, { type: "sep_underscore" }, { type: "event" }]);
      await durchgang([eintrag], quelle, ziel, "Winter Tour");

      pruefe("Zieldatei und Sidecar tragen den erwarteten Namen",
        ziel.fotoNamen().join(",") === "20240517_Winter_Tour.jpg,20240517_Winter_Tour.xmp", ziel.fotoNamen().join(","));
      pruefe("die Quelldatei wurde erst danach gelöscht", !quelle.files.has("r.jpg"));

      if (ziel.files.has("20240517_Winter_Tour.jpg")) {
        const bytes = new Uint8Array(await ziel.files.get("20240517_Winter_Tour.jpg").arrayBuffer());
        pruefe("Stichworte und Beschreibung sind eingebettet",
          verifyWrittenJpegKeywords(bytes, ["Berg", "Schnee"], "Winter Tour") === true);

        // Der Kern der Sicherheitsprüfung: die Bilddaten selbst dürfen sich nicht ändern.
        const vorher = getComparableImageBytes(originalBytes, "jpg");
        const nachher = getComparableImageBytes(bytes, "jpg");
        let gleich = vorher.length === nachher.length;
        if (gleich) for (let i = 0; i < vorher.length; i++) if (vorher[i] !== nachher[i]) { gleich = false; break; }
        pruefe("die Bilddaten ab Start-of-Scan sind byteidentisch", gleich, vorher.length + " vs " + nachher.length);

        // Das Bild muss weiterhin decodierbar sein - ein struktureller Fehler
        // im Segmentbereich fällt sonst erst beim Nutzer auf.
        const url = URL.createObjectURL(ziel.files.get("20240517_Winter_Tour.jpg"));
        const geladen = await new Promise((r) => {
          const img = new Image();
          img.onload = () => r(img.naturalWidth + "x" + img.naturalHeight);
          img.onerror = () => r(null);
          img.src = url;
        });
        URL.revokeObjectURL(url);
        pruefe("die Zieldatei ist ein decodierbares Bild", geladen === "48x32", geladen);
      }

      if (ziel.files.has("20240517_Winter_Tour.xmp")) {
        const inhalt = await ziel.files.get("20240517_Winter_Tour.xmp").text();
        const gelesen = parseXmpData(inhalt);
        pruefe("die Sidecar-Datei enthält dieselben Metadaten",
          gelesen.keywords.join(",") === "Berg,Schnee" && gelesen.description === "Winter Tour",
          gelesen.keywords.join(",") + " / " + gelesen.description);
      }
    }

    {
      // Gegenprobe zur Sicherheitskette: schlägt die Prüfung der Zieldatei fehl,
      // muss die Quelle unangetastet bleiben.
      const quelle = new AttrappenVerzeichnis("quelle");
      const ziel = new AttrappenVerzeichnis("ziel");
      const datei = await jpegDatei("kaputt");
      quelle.files.set("k.jpg", datei);
      const eintrag = fotoEintrag("k.jpg", datei, []);
      eintrag.action = "move";
      namensschema([{ type: "event" }]);

      // Beim Zurücklesen eine verfälschte Datei liefern.
      const echtesGetFileHandle = ziel.getFileHandle.bind(ziel);
      ziel.getFileHandle = async function (name, options) {
        const handle = await echtesGetFileHandle(name, options);
        const echtesGetFile = handle.getFile.bind(handle);
        handle.getFile = async () => {
          const f = await echtesGetFile();
          return f.size > 0 ? new File([new Uint8Array(f.size)], name) : f; // gleiche Größe, andere Bytes
        };
        return handle;
      };
      await durchgang([eintrag], quelle, ziel, "Kaputt");

      pruefe("bei fehlgeschlagener Prüfung bleibt die Quelldatei liegen",
        quelle.files.has("k.jpg"), quelle.namen().join(","));
    }
  } catch (fehler) {
    ergebnisse.push({
      bereich: aktuellerBereich || "Testlauf",
      name: "unerwarteter Abbruch",
      bestanden: false,
      detail: (fehler && fehler.stack) || String(fehler),
    });
  } finally {
    window.confirm = echtesConfirm;
    window.writeKeywordsToJpeg = echtesWriteKeywordsToJpeg;
    // Zustand nicht in der geladenen App zurücklassen
    state.photos = [];
    state.sourceDirHandle = null;
    state.targetDirHandle = null;
    state.cursorIndex = -1;
  }

  window.parent.postMessage({ typ: "fotoImporterTestErgebnis", ergebnisse }, "*");
})();
