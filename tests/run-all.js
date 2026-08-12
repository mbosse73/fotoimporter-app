#!/usr/bin/env node
/**
 * Führt alle automatisierbaren Prüfungen der Definition of Done aus:
 *
 *   node tests/run-all.js
 *
 * 1. Syntax-Check aller Skripte (fängt Tippfehler in app.js ohne Compiler)
 * 2. Prüfung auf doppelte globale Namen (alle Dateien teilen sich einen Scope,
 *    ein doppelter Top-Level-const bricht die App beim Laden komplett)
 * 3. Unit-Tests der Binärformat-Module
 * 4. Browser-Tests der Anwendungslogik (übersprungen, wenn Playwright fehlt)
 *
 * Was hier NICHT geprüft werden kann und weiterhin von Hand gehört: ein
 * Durchlauf mit echten Fotodateien. Die Tests ersetzen die File System Access
 * API durch Attrappen – das prüft die Logik, nicht das Zusammenspiel mit dem
 * echten Dateisystem. Und der echte Pfad löscht endgültig.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.resolve(__dirname, "..");
const schritte = [];

/** @param {'ok'|'fehl'|'uebersprungen'} status */
function melde(name, status, hinweis) {
  schritte.push({ name, status, hinweis: hinweis || "" });
  const marke = status === "ok" ? "✓" : status === "fehl" ? "✗" : "–";
  console.log(`\n${marke} ${name}${hinweis ? " – " + hinweis : ""}`);
}

const jeNach = (bedingung) => (bedingung ? "ok" : "fehl");

function kopf(text) {
  console.log(`\n${"=".repeat(64)}\n${text}\n${"=".repeat(64)}`);
}

/* ---- 1. Syntax ---- */
kopf("1/4  Syntax-Check");
const skripte = fs.readdirSync(WURZEL).filter((f) => f.endsWith(".js"));
const kaputt = [];
for (const datei of skripte) {
  const lauf = spawnSync(process.execPath, ["--check", path.join(WURZEL, datei)], { encoding: "utf8" });
  if (lauf.status === 0) {
    console.log(`  ok    ${datei}`);
  } else {
    console.log(`  FEHL  ${datei}\n${lauf.stderr.split("\n").slice(0, 4).map((z) => "        " + z).join("\n")}`);
    kaputt.push(datei);
  }
}
melde("Syntax-Check", jeNach(kaputt.length === 0), kaputt.length ? `Fehler in ${kaputt.join(", ")}` : `${skripte.length} Dateien`);

/* ---- 2. Doppelte globale Namen ---- */
kopf("2/4  Globale Namen");
const zaehler = new Map();
for (const datei of skripte) {
  const quelle = fs.readFileSync(path.join(WURZEL, datei), "utf8");
  for (const treffer of quelle.matchAll(/^(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
    const name = treffer[1];
    if (!zaehler.has(name)) zaehler.set(name, new Set());
    zaehler.get(name).add(datei);
  }
}
const doppelt = [...zaehler.entries()].filter(([, dateien]) => dateien.size > 1);
for (const [name, dateien] of doppelt) console.log(`  FEHL  ${name} in ${[...dateien].join(", ")}`);
if (doppelt.length === 0) console.log("  ok    keine Dubletten");
melde("Keine doppelten globalen Namen", jeNach(doppelt.length === 0),
  doppelt.length ? doppelt.map(([n]) => n).join(", ") : `${zaehler.size} Namen geprüft`);

/* ---- 3. Unit-Tests ---- */
kopf("3/4  Unit-Tests (Binärformat-Module)");
// Die Testdateien einzeln übergeben: `node --test tests/` würde das Verzeichnis
// als Modul zu laden versuchen und daran scheitern.
const testDateien = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join("tests", f));
const unit = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...testDateien], {
  cwd: WURZEL,
  encoding: "utf8",
  stdio: "inherit",
});
melde("Unit-Tests", jeNach(unit.status === 0), `${testDateien.length} Dateien`);

/* ---- 4. Browser-Tests ---- */
kopf("4/4  Browser-Tests (Anwendungslogik)");
const browser = spawnSync(process.execPath, [path.join(__dirname, "run-browser.js")], {
  cwd: WURZEL,
  encoding: "utf8",
  stdio: "inherit",
});
// Exit-Code 3 bedeutet: Playwright fehlt, die Tests sind nicht gelaufen. Das ist
// kein Fehlschlag, darf aber auch nicht als "bestanden" durchgehen.
melde(
  "Browser-Tests",
  browser.status === 3 ? "uebersprungen" : jeNach(browser.status === 0),
  browser.status === 3 ? "Playwright nicht installiert" : ""
);

/* ---- Zusammenfassung ---- */
kopf("Zusammenfassung");
for (const s of schritte) {
  const marke = s.status === "ok" ? "✓" : s.status === "fehl" ? "✗" : "–";
  console.log(`${marke} ${s.name}${s.hinweis ? " – " + s.hinweis : ""}`);
}
const fehlgeschlagen = schritte.filter((s) => s.status === "fehl");
const uebersprungen = schritte.filter((s) => s.status === "uebersprungen");

if (fehlgeschlagen.length > 0) {
  console.log(`\n${fehlgeschlagen.length} Prüfung(en) fehlgeschlagen.`);
} else if (uebersprungen.length > 0) {
  console.log(
    `\nAlle ausgeführten Prüfungen bestanden, ${uebersprungen.length} übersprungen ` +
    `(${uebersprungen.map((s) => s.name).join(", ")}).\n` +
    "Diese Prüfungen sind NICHT gelaufen - siehe tests/README.md."
  );
} else {
  console.log("\nAlle automatisierbaren Prüfungen bestanden.");
}
console.log("Nicht vergessen: Durchlauf mit KOPIEN echter Fotos in einem Wegwerf-Ordner.");
process.exit(fehlgeschlagen.length === 0 ? 0 : 1);
