"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildXmpPacket, parseXmpData, parseXmpKeywords, escapeXml, unescapeXml } = require("../xmp-packet.js");

test("escapeXml maskiert alle fünf vordefinierten Entitäten", () => {
  assert.strictEqual(escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
});

test("unescapeXml kehrt escapeXml exakt um", () => {
  const roh = `Ein & Zeichen <Test> "zitiert" 'einfach'`;
  assert.strictEqual(unescapeXml(escapeXml(roh)), roh);
});

test("unescapeXml entschärft nicht doppelt", () => {
  // "&amp;lt;" muss zu "&lt;" werden, nicht zu "<" - sonst verändert ein
  // Round-Trip Stichworte, die selbst wie Entitäten aussehen.
  assert.strictEqual(unescapeXml("&amp;lt;"), "&lt;");
});

test("Stichworte laufen unverändert durch den Round-Trip", () => {
  const keywords = ["Berg", "Schnee", "Öl & Wasser"];
  assert.deepStrictEqual(parseXmpKeywords(buildXmpPacket(keywords, null)), keywords);
});

test("Sonderzeichen in Stichworten überleben den Round-Trip", () => {
  const keywords = [`<script>`, `a"b`, `c&d`, `e'f`];
  assert.deepStrictEqual(parseXmpKeywords(buildXmpPacket(keywords, null)), keywords);
});

test("die Beschreibung läuft unverändert durch den Round-Trip", () => {
  const parsed = parseXmpData(buildXmpPacket(["a"], "Winter Tour 2024 & mehr"));
  assert.strictEqual(parsed.description, "Winter Tour 2024 & mehr");
});

test("XMP kürzt Stichworte NICHT - anders als IPTC", () => {
  // Diese Asymmetrie ist der Grund, warum die Konsistenzprüfung in app.js zwei
  // getrennte Erwartungswerte führen muss (Befund M3).
  const lang = "A".repeat(200);
  assert.deepStrictEqual(parseXmpKeywords(buildXmpPacket([lang], null)), [lang]);
});

test("leere und reine Leerraum-Stichworte werden verworfen, übrige getrimmt", () => {
  assert.deepStrictEqual(parseXmpKeywords(buildXmpPacket(["", "  ", "  gut  "], null)), ["gut"]);
});

test("ohne Stichworte entsteht ein leerer Bag, kein kaputtes XML", () => {
  const packet = buildXmpPacket([], null);
  assert.deepStrictEqual(parseXmpKeywords(packet), []);
  assert.ok(packet.includes("<rdf:Bag>") && packet.includes("</rdf:Bag>"));
});

test("ohne Beschreibung fehlt der dc:description-Block ganz", () => {
  const packet = buildXmpPacket(["a"], null);
  assert.ok(!packet.includes("dc:description"));
  assert.strictEqual(parseXmpData(packet).description, null);
});

test("eine leere Beschreibung wird wie keine behandelt", () => {
  assert.strictEqual(parseXmpData(buildXmpPacket(["a"], "   ")).description, null);
});

test("dc:description wird als LangAlt mit x-default geschrieben", () => {
  // Die XMP-Spezifikation verlangt für dc:description ein rdf:Alt; ein einfacher
  // Textwert wird von Lightroom und Bridge nicht gelesen.
  const packet = buildXmpPacket([], "Text");
  assert.ok(packet.includes("<rdf:Alt>"));
  assert.ok(packet.includes(`xml:lang="x-default"`));
});

test("das Paket ist ein vollständiges xpacket mit dc-Namensraum", () => {
  const packet = buildXmpPacket(["a"], "b");
  assert.ok(packet.startsWith("<?xpacket begin="));
  assert.ok(packet.trimEnd().endsWith("<?xpacket end=\"w\"?>"));
  assert.ok(packet.includes("http://purl.org/dc/elements/1.1/"));
});

test("parseXmpData liefert leere Werte für Fremdtext statt zu werfen", () => {
  assert.deepStrictEqual(parseXmpData("kein XMP"), { keywords: [], description: null });
});
