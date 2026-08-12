#!/usr/bin/env node
/**
 * Prüft, ob die Ladereihenfolge der Anwendungsskripte trägt.
 *
 *   node tests/check-load-order.js
 *
 * Seit app.js in mehrere Dateien aufgeteilt ist, gilt eine Regel, die vorher
 * unsichtbar war: Funktionsdeklarationen werden nur INNERHALB ihrer eigenen
 * Datei nach oben gezogen. Code, der beim Laden ausgeführt wird, sieht deshalb
 * nur, was zu diesem Zeitpunkt bereits geladen ist.
 *
 * Der gefährliche Fall ist nicht der offensichtliche Aufruf einer noch nicht
 * geladenen Funktion - der fällt beim ersten Start auf. Gefährlich ist ein
 * Aufruf in einem Zweig, der nur unter bestimmten Bedingungen genommen wird:
 * `applyDefaultFormatIfNone()` etwa greift auf `loadPresetIntoBuilder()` nur
 * dann zu, wenn tatsächlich eine Voreinstellung gespeichert ist. Ein solcher
 * Fehler zeigt sich nicht bei der Entwicklung, sondern bei Nutzern, die das
 * Programm länger benutzen. Genau dafür gibt es diese Prüfung.
 *
 * Die Analyse ist bewusst grob und geht eine Ebene tief: Top-Level-Aufrufe und
 * die Rümpfe der dabei aufgerufenen Funktionen. Sie kann Fehlalarme erzeugen
 * (etwa bei einem Namen, der in einem Kommentar steht), aber sie übersieht den
 * Fall nicht, den sie finden soll. Ein Fehlalarm kostet eine Minute; der Fehler,
 * den sie fängt, kostet einen Nutzer den Programmstart.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.resolve(__dirname, "..");
const INDEX = path.join(WURZEL, "index.html");

/** Liest die Skript-Reihenfolge aus index.html - die ist die Wahrheit. */
function leseSkriptReihenfolge() {
  const html = fs.readFileSync(INDEX, "utf8");
  const dateien = [];
  for (const treffer of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    dateien.push(treffer[1]);
  }
  return dateien;
}

/** Sammelt, in welcher Datei jeder Top-Level-Name deklariert wird. */
function sammleDeklarationen(dateien, quellen) {
  const heimat = new Map();
  dateien.forEach((datei, index) => {
    for (const treffer of quellen.get(datei).matchAll(/^(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
      // Erste Deklaration gewinnt; Dubletten fängt run-all.js separat ab.
      if (!heimat.has(treffer[1])) heimat.set(treffer[1], index);
    }
  });
  return heimat;
}

/**
 * Liefert den Rumpf einer Funktionsdeklaration: von der Kopfzeile bis zur
 * ersten schließenden Klammer in Spalte 0. Verlässt sich darauf, dass die
 * Formatierung im Projekt einheitlich ist - was sie ist.
 */
function funktionsRumpf(quelle, name) {
  const kopf = new RegExp(`^(?:async\\s+)?function ${name}\\(`, "m");
  const treffer = kopf.exec(quelle);
  if (!treffer) return "";
  const rest = quelle.slice(treffer.index);
  const ende = /\n\}/.exec(rest);
  return ende ? rest.slice(0, ende.index) : rest;
}

const dateien = leseSkriptReihenfolge().filter((f) => fs.existsSync(path.join(WURZEL, f)));
const quellen = new Map(dateien.map((f) => [f, fs.readFileSync(path.join(WURZEL, f), "utf8")]));
const heimat = sammleDeklarationen(dateien, quellen);

const befunde = [];

dateien.forEach((datei, index) => {
  const zeilen = quellen.get(datei).split("\n");

  zeilen.forEach((zeile, nr) => {
    /* a) Direkter Top-Level-Aufruf einer später geladenen Funktion. */
    const direkt = /^([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(zeile);
    if (direkt && heimat.has(direkt[1]) && heimat.get(direkt[1]) > index) {
      befunde.push(
        `${datei}:${nr + 1}  ruft beim Laden ${direkt[1]}() auf, ` +
        `deklariert erst in ${dateien[heimat.get(direkt[1])]}`
      );
    }

    /* b) Top-Level-Aufruf, dessen Funktionsrumpf auf eine spätere Datei zugreift. */
    const alleine = /^([A-Za-z_$][A-Za-z0-9_$]*)\(\);?\s*$/.exec(zeile);
    if (!alleine) return;
    const aufgerufen = alleine[1];
    const heimatIndex = heimat.get(aufgerufen);
    if (heimatIndex === undefined) return;

    const rumpf = funktionsRumpf(quellen.get(dateien[heimatIndex]), aufgerufen);
    const gemeldet = new Set();
    for (const inner of rumpf.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\(/g)) {
      const name = inner[1];
      if (name === aufgerufen || gemeldet.has(name)) continue;
      const ziel = heimat.get(name);
      if (ziel !== undefined && ziel > index) {
        gemeldet.add(name);
        befunde.push(
          `${datei}:${nr + 1}  ${aufgerufen}() läuft beim Laden und benutzt ` +
          `${name}() aus ${dateien[ziel]} - das ist dann noch nicht geladen`
        );
      }
    }
  });
});

if (befunde.length > 0) {
  console.error("Ladereihenfolge verletzt:");
  for (const b of befunde) console.error(`  FEHL  ${b}`);
  console.error("\n  Entweder die Funktion in eine frueher geladene Datei verschieben");
  console.error("  oder den Aufruf in die Initialisierung (overlays.js) verlegen.");
  process.exit(1);
}

console.log(`  ok    ${dateien.length} Skripte, keine Zugriffe auf spaeter Geladenes`);
process.exit(0);
