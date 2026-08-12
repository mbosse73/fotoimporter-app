#!/usr/bin/env node
/**
 * Führt tests/browser.html ohne sichtbares Fenster aus und meldet das Ergebnis
 * über den Exit-Code – damit die Browser-Tests auch in einem Skript oder einer
 * CI laufen können, statt nur per Hand im Browser.
 *
 * Der Webserver ist absichtlich hier eingebaut (Node-Bordmittel, ~40 Zeilen):
 * das Projekt hat bewusst keine Abhängigkeiten, und dabei soll es bleiben.
 * Einzig der Browser lässt sich nicht selbst schreiben.
 *
 *   node tests/run-browser.js
 *
 * Exit-Codes:
 *   0 = alle Prüfungen bestanden
 *   1 = mindestens eine Prüfung fehlgeschlagen (oder der Lauf war nicht möglich)
 *   3 = übersprungen, weil Playwright nicht installiert ist
 *
 * Die 3 ist bewusst von der 0 getrennt: „nicht gelaufen" als „bestanden" zu
 * melden, wäre die gefährlichere Lüge.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.resolve(__dirname, "..");
const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function starteServer() {
  const server = http.createServer((req, res) => {
    const pfad = decodeURIComponent(req.url.split("?")[0]);
    const ziel = path.join(WURZEL, pfad === "/" ? "/index.html" : pfad);

    // Nichts außerhalb des Projektverzeichnisses ausliefern.
    if (!ziel.startsWith(WURZEL + path.sep) && ziel !== path.join(WURZEL, "index.html")) {
      res.writeHead(403).end("verboten");
      return;
    }
    fs.readFile(ziel, (fehler, daten) => {
      if (fehler) { res.writeHead(404).end("nicht gefunden"); return; }
      res.writeHead(200, { "Content-Type": TYPEN[path.extname(ziel)] || "application/octet-stream" });
      res.end(daten);
    });
  });
  return new Promise((auf) => server.listen(0, "127.0.0.1", () => auf(server)));
}

function ladePlaywright() {
  try {
    return require("playwright");
  } catch (e) {
    return null;
  }
}

(async () => {
  const playwright = ladePlaywright();
  if (!playwright) {
    console.log("Playwright ist nicht installiert – Browser-Tests übersprungen.");
    console.log("Von Hand ausführen:");
    console.log("  python3 -m http.server 8000");
    console.log("  http://localhost:8000/tests/browser.html im Browser öffnen");
    console.log("Oder einmalig einrichten (nur zum Testen, keine Laufzeit-Abhängigkeit):");
    console.log("  npm install --no-save playwright && npx playwright install chromium");
    process.exit(3);
  }

  const server = await starteServer();
  const adresse = `http://127.0.0.1:${server.address().port}/tests/browser.html`;

  // PLAYWRIGHT_CHROMIUM erlaubt es, einen bereits vorhandenen Chromium zu nutzen,
  // statt ihn von Playwright herunterladen zu lassen.
  const startOptionen = process.env.PLAYWRIGHT_CHROMIUM
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
    : {};

  let browser;
  let exitCode = 1;
  try {
    browser = await playwright.chromium.launch(startOptionen);
    const seite = await browser.newPage();

    const seitenFehler = [];
    seite.on("pageerror", (e) => seitenFehler.push(e.message));

    await seite.goto(adresse, { waitUntil: "load" });
    await seite.waitForFunction(() => window.__fotoImporterTestErgebnis !== undefined, null, { timeout: 60000 });
    const ergebnis = await seite.evaluate(() => window.__fotoImporterTestErgebnis);

    let letzterBereich = null;
    for (const e of ergebnis.ergebnisse) {
      if (e.bereich !== letzterBereich) {
        console.log(`\n# ${e.bereich}`);
        letzterBereich = e.bereich;
      }
      console.log(`${e.bestanden ? "  ok  " : " FEHL "} ${e.name}${e.detail ? "   → " + e.detail : ""}`);
    }

    console.log(`\n${ergebnis.gesamt - ergebnis.fehlgeschlagen}/${ergebnis.gesamt} Prüfungen bestanden.`);
    if (seitenFehler.length > 0) {
      console.log(`Unbehandelte Fehler auf der Testseite: ${seitenFehler.join(" | ")}`);
    }
    exitCode = ergebnis.fehlgeschlagen === 0 ? 0 : 1;
  } catch (fehler) {
    console.error("Browser-Tests konnten nicht ausgeführt werden:", fehler.message);
    if (/Executable doesn't exist/.test(fehler.message)) {
      console.error("Hinweis: 'npx playwright install chromium' ausführen oder PLAYWRIGHT_CHROMIUM auf einen vorhandenen Chromium setzen.");
    }
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  process.exit(exitCode);
})();
