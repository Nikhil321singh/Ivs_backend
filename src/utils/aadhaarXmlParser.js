const { XMLParser } = require('fast-xml-parser');

/**
 * Decodes and parses the Base64 Aadhaar XML DigiLocker returns.
 *
 * A pure function: no I/O, no database, no logging of content. It receives a
 * Base64 string and returns normalized fields or throws. That makes it fully
 * testable against fixtures and keeps Aadhaar data out of every other layer.
 *
 * SECURITY. This parses an XML document that reached us from outside, so it is
 * the feature's main attack surface. Three defences, in order:
 *
 *   1. Size caps applied BEFORE parsing, to both the Base64 and the decoded
 *      payload. An XML bomb is small encoded and enormous expanded, so the cap
 *      has to bite before the parser ever sees the document.
 *   2. Entity processing disabled outright (`processEntities: false`). This is
 *      what neutralises XXE and billion-laughs style expansion: no entity is
 *      ever resolved, so an external or recursive one cannot be followed.
 *      fast-xml-parser also never fetches DTDs or external resources.
 *   3. No value coercion (`parseTagValue: false`). Everything stays a string,
 *      so a date or an Aadhaar fragment cannot be silently mangled into a
 *      number and lose leading zeros.
 */

// Generous enough for a real Aadhaar XML (a few KB), far below anything that
// could exhaust memory.
const MAX_BASE64_BYTES = 512 * 1024; // 512 KB encoded
const MAX_XML_BYTES = 1024 * 1024; // 1 MB decoded

class AadhaarXmlError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'AadhaarXmlError';
    this.reason = reason;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // See defence 2 and 3 above. Both must stay false.
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Base64 that decodes back to itself — rejects truncated or mangled input. */
const decodeBase64 = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AadhaarXmlError('Aadhaar document was empty.', 'empty');
  }

  const cleaned = value.replace(/\s/g, '');

  if (Buffer.byteLength(cleaned, 'utf8') > MAX_BASE64_BYTES) {
    throw new AadhaarXmlError('Aadhaar document was too large.', 'too_large');
  }

  const buffer = Buffer.from(cleaned, 'base64');

  // Buffer.from is lenient: it silently drops invalid characters rather than
  // throwing. Re-encoding and comparing is what actually catches junk input.
  if (buffer.length === 0 || buffer.toString('base64').replace(/=+$/, '') !== cleaned.replace(/=+$/, '')) {
    throw new AadhaarXmlError('Aadhaar document was not valid Base64.', 'invalid_base64');
  }

  if (buffer.length > MAX_XML_BYTES) {
    throw new AadhaarXmlError('Aadhaar document was too large.', 'too_large');
  }

  return buffer.toString('utf8');
};

/**
 * Walks the parsed tree collecting every attribute and leaf value, keyed by
 * lower-cased name.
 *
 * Deliberately structure-agnostic. UIDAI's offline XML nests the fields we want
 * under elements whose exact names and depth are not specified in the
 * integration brief, and the brief explicitly says not to invent them. Indexing
 * every name once lets FIELD_ALIASES below map the real document without this
 * function having to know its shape — and makes adapting to the confirmed
 * schema a change to the alias table alone.
 */
const flatten = (node, into = {}) => {
  if (node === null || node === undefined) return into;

  if (typeof node !== 'object') {
    return into;
  }

  Object.entries(node).forEach(([key, value]) => {
    const name = key.replace(/^@_/, '').toLowerCase();

    if (value !== null && typeof value === 'object') {
      flatten(value, into);
      return;
    }

    if (value !== null && value !== undefined && String(value).trim() !== '') {
      // First occurrence wins: the outermost match is the document's own field
      // rather than something repeated deeper in a signature block.
      if (into[name] === undefined) into[name] = String(value).trim();
    }
  });

  return into;
};

/**
 * Candidate names for each field we need, most-likely first.
 *
 * UNCONFIRMED against the real provider document — the brief specifies only
 * that the API returns Base64 XML, not its internal schema. These cover the
 * names UIDAI's offline e-KYC XML is commonly published with. Confirm against a
 * real UAT response and trim this table to the actual names.
 */
const FIELD_ALIASES = Object.freeze({
  name: ['name', 'poi_name', 'uidname', 'aadhaarname'],
  dateOfBirth: ['dob', 'date_of_birth', 'dateofbirth', 'birthdate'],
  gender: ['gender', 'poi_gender', 'sex'],
  maskedAadhaar: ['maskedaadhaar', 'masked_aadhaar', 'uid', 'aadhaarnumber', 'aadhaar_number'],
  referenceId: ['referenceid', 'reference_id'],
});

const firstMatch = (flat, aliases) => {
  const hit = aliases.find((alias) => flat[alias] !== undefined);
  return hit ? flat[hit] : null;
};

/**
 * Masks whatever Aadhaar-ish value the document carried.
 *
 * The document may already be masked, may be a reference id, or may be a full
 * number. Whichever it is, only the last four digits leave this function — the
 * full value must never be stored, returned or logged.
 */
const maskAadhaar = (value) => {
  if (!value) return null;

  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return null;

  return `XXXX-XXXX-${digits.slice(-4)}`;
};

/**
 * Base64 Aadhaar XML in, normalized fields out.
 *
 * Throws AadhaarXmlError with a `reason` the service maps to a failure code.
 * A document that parses but carries no recognisable name is treated as invalid
 * rather than returned as a half-empty "verified" result.
 */
const parse = (base64Xml) => {
  const xml = decodeBase64(base64Xml);

  let tree;
  try {
    tree = parser.parse(xml);
  } catch {
    // The parser error is not surfaced: it can quote document content.
    throw new AadhaarXmlError('Aadhaar document could not be read.', 'malformed_xml');
  }

  if (!tree || typeof tree !== 'object' || Object.keys(tree).length === 0) {
    throw new AadhaarXmlError('Aadhaar document was empty.', 'malformed_xml');
  }

  const flat = flatten(tree);

  const name = firstMatch(flat, FIELD_ALIASES.name);
  const dateOfBirth = firstMatch(flat, FIELD_ALIASES.dateOfBirth);
  const gender = firstMatch(flat, FIELD_ALIASES.gender);
  const maskedAadhaar = maskAadhaar(firstMatch(flat, FIELD_ALIASES.maskedAadhaar));

  if (!name) {
    throw new AadhaarXmlError(
      'Aadhaar document did not contain the expected details.',
      'unexpected_schema'
    );
  }

  return {
    verified: true,
    documentType: 'AADHAAR',
    name,
    dateOfBirth,
    gender,
    maskedAadhaar,
  };
};

module.exports = {
  parse,
  maskAadhaar,
  AadhaarXmlError,
  MAX_BASE64_BYTES,
  MAX_XML_BYTES,
};
