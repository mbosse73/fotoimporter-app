#!/usr/bin/env node
/**
 * Erzeugt help-content.js aus HANDBUCH.md.
 *
 *   node tools/sync-help.js          erzeugen/aktualisieren
 *   node tools/sync-help.js --check  nur prüfen, ob die Datei aktuell ist
 *
 * Warum es dieses Skript gibt: Handbuch und eingebaute Hilfe (F1) sagten
 * dasselbe an zwei Stellen. Zwei Quellen für dieselbe Aussage laufen zuverlässig
 * auseinander - nicht sofort, sondern bei der dritten Änderung, die jemand nur
 * an einer Stelle nachzieht. Seitdem ist HANDBUCH.md die einzige Quelle, und
 * help-content.js wird daraus erzeugt.
 *
 * Die erzeugte Datei ist eingecheckt und nicht in .gitignore: die Anwendung
 * kommt ohne Build-Schritt aus, und wer die index.html öffnet, soll eine
 * vollständige Hilfe vorfinden. Dass sie aktuell ist, prüft run-all.js mit.
 *
 * Der Markdown-Übersetzer hier ist absichtlich klein: er kann genau das, was
 * HANDBUCH.md verwendet (Überschriften, Absätze, Listen, Tabellen, fett,
 * `Code`, Links). Ein vollständiger Markdown-Übersetzer wäre eine Abhängigkeit -
 * und das Projekt hat bewusst keine.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.resolve(__dirname, "..");
const QUELLE = path.join(WURZEL, "HANDBUCH.md");
const ZIEL = path.join(WURZEL, "help-content.js");

/** Abschnitte, die in der eingebauten Hilfe nichts verloren haben. */
const UEBERSPRINGEN = new Set(["Inhaltsverzeichnis"]);

/* ------------------------------------------------------------
   Markdown -> HTML
   ------------------------------------------------------------ */

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Übersetzt die Auszeichnungen innerhalb einer Zeile.
 *
 * `Code` wird zu <kbd> statt <code>: im Handbuch steht diese Auszeichnung fast
 * ausschließlich für Tasten, und die Hilfe stellt <kbd> als Taste dar.
 * Zuerst maskieren, dann Auszeichnungen einsetzen - sonst würde ein `<` aus dem
 * Text die eingesetzten Tags zerlegen.
 */
function inlineToHtml(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, (m, inhalt) => `<kbd>${inhalt}</kbd>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, (m, inhalt) => `<b>${inhalt}</b>`);
  // Verweise auf Abschnitte des Handbuchs (#anker) führen in der eingebauten
  // Hilfe ins Leere - dort gibt es die Kapitelliste daneben. Nur der Text bleibt.
  html = html.replace(/\[([^\]]+)\]\(#[^)]*\)/g, (m, beschriftung) => beschriftung);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, beschriftung, ziel) =>
    `<a href="${ziel}" target="_blank" rel="noopener">${beschriftung}</a>`);
  return html;
}

/** Zerlegt eine Tabellenzeile "| a | b |" in ihre Zellen. */
function tabellenZellen(zeile) {
  return zeile.replace(/^\||\|$/g, "").split("|").map((z) => z.trim());
}

const IST_TRENNZEILE = /^\|[\s:|-]+\|$/;

/**
 * Übersetzt einen Block Markdown-Zeilen in HTML. Bewusst zeilenorientiert: die
 * verwendeten Konstrukte sind alle zeilenbasiert, und ein zeichenweiser Parser
 * wäre um ein Vielfaches länger, ohne hier etwas zu können.
 */
function blockToHtml(zeilen) {
  const teile = [];
  let i = 0;

  while (i < zeilen.length) {
    const zeile = zeilen[i];

    if (zeile.trim() === "") { i++; continue; }

    if (zeile.startsWith("### ")) {
      teile.push(`<h4>${inlineToHtml(zeile.slice(4).trim())}</h4>`);
      i++;
      continue;
    }

    if (zeile.trim() === "---") { i++; continue; }

    /* Tabelle */
    if (zeile.startsWith("|")) {
      const kopf = tabellenZellen(zeile);
      const zeilenHtml = [];
      i++;
      if (i < zeilen.length && IST_TRENNZEILE.test(zeilen[i].trim())) i++;
      while (i < zeilen.length && zeilen[i].startsWith("|")) {
        const zellen = tabellenZellen(zeilen[i]);
        zeilenHtml.push(`<tr>${zellen.map((z) => `<td>${inlineToHtml(z)}</td>`).join("")}</tr>`);
        i++;
      }
      teile.push(
        `<table class="helpTable"><thead><tr>${kopf.map((z) => `<th>${inlineToHtml(z)}</th>`).join("")}` +
        `</tr></thead><tbody>${zeilenHtml.join("")}</tbody></table>`
      );
      continue;
    }

    /* Aufzählung */
    if (/^[-*] /.test(zeile)) {
      const punkte = [];
      while (i < zeilen.length && /^[-*] /.test(zeilen[i])) {
        punkte.push(`<li>${inlineToHtml(zeilen[i].replace(/^[-*] /, "").trim())}</li>`);
        i++;
      }
      teile.push(`<ul>${punkte.join("")}</ul>`);
      continue;
    }

    /* Nummerierte Liste */
    if (/^\d+\. /.test(zeile)) {
      const punkte = [];
      while (i < zeilen.length && /^\d+\. /.test(zeilen[i])) {
        punkte.push(`<li>${inlineToHtml(zeilen[i].replace(/^\d+\. /, "").trim())}</li>`);
        i++;
      }
      teile.push(`<ol>${punkte.join("")}</ol>`);
      continue;
    }

    /* Absatz: bis zur nächsten Leerzeile oder zum nächsten Blockanfang */
    const absatz = [];
    while (
      i < zeilen.length &&
      zeilen[i].trim() !== "" &&
      !zeilen[i].startsWith("|") &&
      !zeilen[i].startsWith("### ") &&
      !/^[-*] /.test(zeilen[i]) &&
      !/^\d+\. /.test(zeilen[i]) &&
      zeilen[i].trim() !== "---"
    ) {
      absatz.push(zeilen[i].trim());
      i++;
    }
    if (absatz.length > 0) teile.push(`<p>${inlineToHtml(absatz.join(" "))}</p>`);
  }

  return teile.join("\n      ");
}

/**
 * Bildet eine Überschrift auf eine Kapitel-ID ab. Dieselbe Regel wie GitHub für
 * Anker verwendet, damit die IDs mit den Verweisen im Handbuch übereinstimmen.
 */
function titelZuId(titel) {
  return titel
    .toLowerCase()
    .replace(/[():,./]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Zerlegt HANDBUCH.md in Kapitel entlang der ##-Überschriften. */
function leseKapitel(markdown) {
  const zeilen = markdown.split("\n");
  const kapitel = [];
  let aktuell = null;

  for (const zeile of zeilen) {
    const treffer = /^## (.+)$/.exec(zeile);
    if (treffer) {
      const titel = treffer[1].trim();
      aktuell = UEBERSPRINGEN.has(titel) ? null : { titel, zeilen: [] };
      if (aktuell) kapitel.push(aktuell);
      continue;
    }
    if (aktuell) aktuell.zeilen.push(zeile);
  }

  return kapitel.map((k) => ({
    id: titelZuId(k.titel),
    title: k.titel,
    html: `\n      <h3>${inlineToHtml(k.titel)}</h3>\n      ${blockToHtml(k.zeilen)}\n    `,
  }));
}

/** Baut den Inhalt von help-content.js. */
function baueDatei(kapitel) {
  const eintraege = kapitel.map((k) =>
    "  {\n" +
    `    id: ${JSON.stringify(k.id)},\n` +
    `    title: ${JSON.stringify(k.title)},\n` +
    "    html: `" + k.html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`,\n" +
    "  },"
  ).join("\n");

  return `/**
 * ERZEUGTE DATEI - NICHT VON HAND BEARBEITEN.
 *
 * Quelle: HANDBUCH.md
 * Erzeugt mit: node tools/sync-help.js
 *
 * Aenderungen gehoeren ins Handbuch; dieses Skript zieht die eingebaute Hilfe
 * (F1) daraus nach. run-all.js prueft, dass beide zusammenpassen.
 */

const HELP_CHAPTERS = [
${eintraege}
];

if (typeof module !== "undefined") {
  module.exports = { HELP_CHAPTERS };
}
`;
}

/* ------------------------------------------------------------
   Hauptprogramm
   ------------------------------------------------------------ */

const markdown = fs.readFileSync(QUELLE, "utf8");
const kapitel = leseKapitel(markdown);
const inhalt = baueDatei(kapitel);

if (process.argv.includes("--check")) {
  const bisher = fs.existsSync(ZIEL) ? fs.readFileSync(ZIEL, "utf8") : "";
  if (bisher === inhalt) {
    console.log(`ok    help-content.js ist aktuell (${kapitel.length} Kapitel)`);
    process.exit(0);
  }
  console.error("FEHL  help-content.js passt nicht zu HANDBUCH.md.");
  console.error("      Erzeugen mit: node tools/sync-help.js");
  process.exit(1);
}

fs.writeFileSync(ZIEL, inhalt, "utf8");
console.log(`help-content.js erzeugt: ${kapitel.length} Kapitel aus HANDBUCH.md.`);
