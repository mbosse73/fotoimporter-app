/**
 * XMP-Paket-Erzeugung (RDF/XML) für Stichwörter.
 * Nutzt das Dublin-Core-Feld dc:subject mit rdf:Bag (Standard-Ort für Keywords,
 * siehe XMP Specification Part 2 sowie gängige Praxis in Lightroom, Bridge, etc.).
 */

/** Escaped Sonderzeichen für die Verwendung als Text-Inhalt in XML. */
function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Baut ein vollständiges XMP-Paket (RDF/XML) mit den übergebenen Stichwörtern
 * in dc:subject sowie optional einer Beschreibung in dc:description. Kann
 * sowohl als eigenständige .xmp-Sidecar-Datei gespeichert als auch (mit den
 * passenden Wrapper-Bytes) in ein JPEG eingebettet werden.
 *
 * dc:description ist laut XMP-Spezifikation ein "Language Alternative" (LangAlt),
 * kein einfacher Text - die Struktur verlangt ein rdf:Alt mit mindestens einem
 * rdf:li-Eintrag mit xml:lang-Attribut. "x-default" ist die konventionelle
 * Sprachkennung für den Hauptwert ohne spezifische Sprachzuordnung.
 *
 * @param {string[]} keywords
 * @param {string} [description]
 * @returns {string}
 */
function buildXmpPacket(keywords, description) {
  const validKeywords = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  const bagItems = validKeywords.map((k) => `      <rdf:li>${escapeXml(k)}</rdf:li>`).join("\n");
  const trimmedDescription = description ? description.trim() : "";

  const descriptionBlock = trimmedDescription
    ? `      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(trimmedDescription)}</rdf:li>
        </rdf:Alt>
      </dc:description>\n`
    : "";

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="FotoImporter 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:subject>
        <rdf:Bag>
${bagItems}
        </rdf:Bag>
      </dc:subject>
${descriptionBlock}    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Parst ein XMP-Paket zurück in Stichwörter (dc:subject/rdf:Bag/rdf:li) und die
 * Beschreibung (dc:description/rdf:Alt/rdf:li). Bewusst ein simpler regex-/
 * string-basierter Parser statt eines vollständigen XML-Parsers, da wir nur
 * dieses eine, selbst erzeugte Format zurücklesen müssen (Konsistenz-Check
 * nach dem Schreiben) - kein generischer XMP-Reader für Fremd-Dateien.
 * @param {string} xmpString
 * @returns {{keywords: string[], description: string|null}}
 */
function parseXmpData(xmpString) {
  const keywords = parseXmpKeywords(xmpString);

  let description = null;
  const descMatch = xmpString.match(/<dc:description>([\s\S]*?)<\/dc:description>/);
  if (descMatch) {
    const liMatch = descMatch[1].match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
    if (liMatch) description = unescapeXml(liMatch[1]);
  }

  return { keywords, description };
}

/**
 * Parst ein XMP-Paket zurück in eine Liste von Stichwörtern (dc:subject/rdf:Bag/rdf:li).
 * @param {string} xmpString
 * @returns {string[]}
 */
function parseXmpKeywords(xmpString) {
  const subjectMatch = xmpString.match(/<dc:subject>([\s\S]*?)<\/dc:subject>/);
  if (!subjectMatch) return [];
  const bagContent = subjectMatch[1];
  const liMatches = [...bagContent.matchAll(/<rdf:li>([\s\S]*?)<\/rdf:li>/g)];
  return liMatches.map((m) => unescapeXml(m[1]));
}

function unescapeXml(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // muss zuletzt passieren, sonst würde &amp;lt; falsch doppelt entschärft
}

if (typeof module !== "undefined") {
  module.exports = { buildXmpPacket, parseXmpKeywords, parseXmpData, escapeXml, unescapeXml };
}
