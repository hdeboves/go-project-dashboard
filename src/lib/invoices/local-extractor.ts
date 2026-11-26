import { round2 } from "@/lib/budget/calculator";
import { normalizeProjectCodesList } from "@/lib/invoices/accounting-email";
import type { InvoiceExtractionOutput } from "@/lib/ports";

/**
 * Our own company identities (BUYER / CLIENT on incoming supplier invoices).
 * These MUST NEVER be detected as the vendor/prestataire!
 */
export const OWN_COMPANY_PATTERNS: readonly RegExp[] = [
  /\bgamers\s*origin\b/i,
  /\bgamersorigin\b/i,
  /\bl['’`´]?\s*intrus\b/i,
  /\blintrus\b/i,
  /\bgamersorigin\.com\b/i,
  /\blintrus\.(fr|com)\b/i,
];

export function isOwnCompanyName(input: string | null | undefined): boolean {
  const value = (input ?? "").trim();
  if (!value) return false;
  return OWN_COMPANY_PATTERNS.some((re) => re.test(value));
}

function normalizeAsciiLower(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  "janv": "01",
  jan: "01",
  january: "01",
  fevrier: "02",
  fevr: "02",
  fev: "02",
  february: "02",
  feb: "02",
  mars: "03",
  mar: "03",
  march: "03",
  avril: "04",
  avr: "04",
  april: "04",
  apr: "04",
  mai: "05",
  may: "05",
  juin: "06",
  jun: "06",
  june: "06",
  juillet: "07",
  juil: "07",
  jul: "07",
  july: "07",
  aout: "08",
  august: "08",
  aug: "08",
  septembre: "09",
  sept: "09",
  sep: "09",
  september: "09",
  octobre: "10",
  oct: "10",
  october: "10",
  novembre: "11",
  nov: "11",
  november: "11",
  decembre: "12",
  dec: "12",
  december: "12",
};

function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2015 || year > 2040 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  return true;
}

function parseDateFromSegment(segment: string): string | null {
  // 1. ISO YYYY-MM-DD
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(segment);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  // 2. DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
  const dmy4 = /\b(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2})\b/.exec(segment);
  if (dmy4) {
    const candidate = `${dmy4[3]}-${dmy4[2].padStart(2, "0")}-${dmy4[1].padStart(2, "0")}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  // 3. French / English written month: "15 octobre 2026" or "1er nov. 2026"
  const norm = normalizeAsciiLower(segment);
  const writtenFr =
    /\b(\d{1,2})(?:er|eme|e)?\s+([a-z]{3,12})\.?\s+(20\d{2})\b/.exec(norm);
  if (writtenFr) {
    const month = FRENCH_MONTHS[writtenFr[2]];
    if (month) {
      const candidate = `${writtenFr[3]}-${month}-${writtenFr[1].padStart(2, "0")}`;
      if (isValidIsoDate(candidate)) return candidate;
    }
  }

  // 4. English written month: "November 15, 2026"
  const writtenEn =
    /\b([a-z]{3,12})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/.exec(norm);
  if (writtenEn) {
    const month = FRENCH_MONTHS[writtenEn[1]];
    if (month) {
      const candidate = `${writtenEn[3]}-${month}-${writtenEn[2].padStart(2, "0")}`;
      if (isValidIsoDate(candidate)) return candidate;
    }
  }

  // 5. Short year DD/MM/YY
  const dmy2 = /\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{2})\b/.exec(segment);
  if (dmy2) {
    const candidate = `20${dmy2[3]}-${dmy2[2].padStart(2, "0")}-${dmy2[1].padStart(2, "0")}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  return null;
}

export function extractIssueDate(pdfText: string, filename: string): string {
  const lines = pdfText.split(/\r?\n/);

  // Priority 1: explicitly labeled emission / invoice date (ignore due dates!)
  const issueLabelRe =
    /(?:date\s+d['’]?\s*[ée]mission|date\s+de\s+factur(?:e|ation)|date\s+facture|[ée]mise?\s+le|factur[ée]e?\s+le|invoice\s+date|issue\s+date|fait\s+(?:[àa]\s+\S+\s+)?le|date\s*:)/i;
  const dueDateRe =
    /(?:[ée]ch[ée]ance|due\s+date|date\s+limite|r[èe]glement\s+avant|payable\s+(?:avant|le)|[àa]\s+payer\s+avant)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (dueDateRe.test(line) && !issueLabelRe.test(line)) continue;
    const match = issueLabelRe.exec(line);
    if (match) {
      const after = line.slice(match.index);
      const parsed = parseDateFromSegment(after);
      if (parsed) return parsed;
      // Sometimes date is on the very next line (table header / value layout)
      if (i + 1 < lines.length && !dueDateRe.test(lines[i + 1])) {
        const nextParsed = parseDateFromSegment(lines[i + 1]);
        if (nextParsed) return nextParsed;
      }
    }
  }

  // Priority 2: any non-due-date line containing a date
  for (const line of lines) {
    if (dueDateRe.test(line)) continue;
    const parsed = parseDateFromSegment(line);
    if (parsed) return parsed;
  }

  // Priority 3: filename
  const fromFilename = parseDateFromSegment(filename);
  if (fromFilename) return fromFilename;

  return new Date().toISOString().slice(0, 10);
}

function isBadInvoiceNumberCandidate(candidate: string): boolean {
  const clean = candidate.trim();
  if (clean.length < 2 || clean.length > 32) return true;
  if (!/\d/.test(clean)) return true;
  // Reject dates (YYYY-MM-DD or DD/MM/YYYY)
  if (/^(?:20\d{2}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]20\d{2})$/.test(clean)) {
    return true;
  }
  // Reject SIRET (14 digits), SIREN (9 digits), French phone numbers, FR VAT numbers, postal codes
  const digitsOnly = clean.replace(/\D/g, "");
  if (digitsOnly.length === 14 || digitsOnly.length === 9) return true;
  if (/^FR\d{11}$/i.test(clean)) return true;
  if (/^0[1-9]\d{8}$/.test(digitsOnly)) return true;
  // Reject generic words
  if (/^(?:page|tva|siret|siren|iban|bic|eur|euro|ht|ttc|cp|client|devis|tel|fax)$/i.test(clean)) {
    return true;
  }
  return false;
}

export function extractInvoiceNumber(pdfText: string, filename: string): string {
  const patterns: RegExp[] = [
    /(?:num[ée]ro\s+de\s+facture|n[°o]\s*(?:de\s+)?facture|facture\s*(?:d['’]acompte|de\s+solde)?\s*n[°o]?|invoice\s*(?:number|no\.?|#|n[°o])|r[ée]f(?:[ée]rence)?\.?\s*facture)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_.-]{1,28})/gi,
    /\b((?:FAC|FA|FACT|INV|FC|F)[-_./]?(?:20)?\d{2}[-_./]?\d{1,6})\b/gi,
    /\b((?:FAC|FA|INV|FC)[-_.]?\d{3,10})\b/gi,
    /(?:facture|invoice)\s*[:#-]\s*([A-Z0-9][A-Z0-9/_.-]{2,24})/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pdfText)) !== null) {
      const candidate = (m[1] ?? "").replace(/[.,;:]+$/, "").trim();
      if (!isBadInvoiceNumberCandidate(candidate)) {
        return candidate;
      }
    }
  }

  // Try line-by-line where "Facture n°" is followed by a code on the same or next line
  const lines = pdfText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/(?:facture|invoice)\s*(?:n[°o]|#|num)/i.test(lines[i])) {
      const combined = `${lines[i]} ${lines[i + 1] ?? ""}`;
      const token = /\b([A-Z]{0,5}[-_/]?\d{2,4}[-_/]\d{1,6}|[A-Z]{1,4}\d{4,10})\b/i.exec(
        combined
      );
      if (token?.[1] && !isBadInvoiceNumberCandidate(token[1])) {
        return token[1].trim();
      }
    }
  }

  // Fallback to filename (e.g. FAC-2026-042_326015_Studio.pdf or F2026-012.pdf)
  const fnPatterns = [
    /\b((?:FAC|FA|FACT|INV|FC|F)[-_.]?(?:20)?\d{2}[-_.]?\d{1,6})\b/i,
    /\b((?:FAC|FA|INV|FC)[-_.]?\d{2,10})\b/i,
  ];
  for (const re of fnPatterns) {
    const m = re.exec(filename);
    if (m?.[1] && !isBadInvoiceNumberCandidate(m[1])) {
      return m[1].trim();
    }
  }

  return "";
}

export function parseMoneyAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  let cleaned = raw
    .replace(/[€$£]/g, "")
    .replace(/\b(?:EUR|EUROS?|HT|TTC)\b/gi, "")
    .replace(/[\u00A0\u202F\s]/g, "")
    .trim();

  if (!cleaned) return 0;

  // Handle both French "1.250,50" / "1250,50" and US "1,250.50" / "1250.50"
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // European: 1.250,50 -> 1250.50
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US: 1,250.50 -> 1250.50
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const decimals = cleaned.length - lastComma - 1;
    if (decimals <= 2) {
      cleaned = cleaned.replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals === 3 && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
      // Thousand separator "3.500"
      cleaned = cleaned.replace(/\./g, "");
    }
  }

  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? round2(num) : 0;
}

const AMOUNT_TOKEN_SRC =
  "(?:€|EUR)?\\s*(\\d{1,3}(?:[\\s\\u00A0\\u202F.,]\\d{3})*(?:[.,]\\d{2})|\\d+(?:[.,]\\d{2})?)\\s*(?:€|EUR)?";

function findLastLabeledAmount(text: string, labelRegex: RegExp): number {
  const lines = text.split(/\r?\n/);
  const matches: number[] = [];

  const amtAfterRe = new RegExp(AMOUNT_TOKEN_SRC, "gi");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = labelRegex.exec(line);
    if (!m) continue;

    // Look on the remainder of the line after the label
    const tail = line.slice(m.index + m[0].length);
    const localAmts: number[] = [];
    amtAfterRe.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = amtAfterRe.exec(tail)) !== null) {
      // Ignore percentages like "20,00 %"
      const nextChar = tail.slice(am.index + am[0].length).trimStart()[0];
      if (nextChar === "%") continue;
      const val = parseMoneyAmount(am[1]);
      if (val > 0) localAmts.push(val);
    }

    if (localAmts.length > 0) {
      // Take the first money amount immediately following the label
      matches.push(localAmts[0]);
      continue;
    }

    // Sometimes the total value sits on the very next line
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const nextMatch = new RegExp(`^${AMOUNT_TOKEN_SRC}$`, "i").exec(nextLine);
      if (nextMatch) {
        const val = parseMoneyAmount(nextMatch[1]);
        if (val > 0) matches.push(val);
      }
    }
  }

  return matches.length > 0 ? matches[matches.length - 1] : 0;
}

/**
 * Computes the next sequential invoice number starting strictly at "1" (1, 2, 3, ...).
 */
export function computeNextSequentialInvoiceNumber(
  existingInvoiceNumbers: readonly (string | null | undefined)[]
): string {
  let maxSeq = 0;
  for (const raw of existingInvoiceNumbers) {
    const clean = (raw ?? "").trim();
    if (/^\d+$/.test(clean)) {
      const n = Number.parseInt(clean, 10);
      if (Number.isSafeInteger(n) && n > maxSeq) {
        maxSeq = n;
      }
    }
  }
  return String(maxSeq + 1);
}

/**
 * Extracts strictly the HT (Hors Taxes) amount from the invoice PDF text.
 * VAT/TVA is intentionally ignored (tvaRate = 0, montantTTC = montantHT) because
 * only Montant HT is tracked and imputed into the project budget.
 */
export function extractAmounts(pdfText: string): {
  montantHT: number;
  tvaRate: number;
  montantTTC: number;
} {
  let montantHT = findLastLabeledAmount(
    pdfText,
    /(?:total\s+(?:net\s+|g[ée]n[ée]ral\s+)?ht|montant\s+(?:total\s+)?ht|sous[- ]?total\s*(?:ht)?|total\s+hors\s+taxes?|base\s+ht|subtotal)\b/i
  );

  // If no explicit HT label was found, recover HT from TTC - TVA or from a single generic Total
  if (montantHT === 0) {
    const montantTVA = findLastLabeledAmount(
      pdfText,
      /(?:total\s+tva|montant\s+(?:de\s+la\s+)?tva|tva\s*(?:\(\s*\d+(?:[.,]\d+)?\s*%\s*\)|\d+(?:[.,]\d+)?\s*%)?)\s*[:|]?\s*(?!non\s+applicable)/i
    );
    const montantTTC = findLastLabeledAmount(
      pdfText,
      /(?:net\s+[àa]\s+payer(?:\s+ttc)?|total\s+(?:g[ée]n[ée]ral\s+)?ttc|montant\s+(?:total\s+)?ttc|total\s+[àa]\s+payer|montant\s+d[ûu]|grand\s+total|amount\s+due)\b/i
    );

    if (montantTTC > 0) {
      if (montantTVA > 0 && montantTVA < montantTTC) {
        montantHT = round2(montantTTC - montantTVA);
      } else {
        montantHT = montantTTC;
      }
    } else {
      const genericTotal = findLastLabeledAmount(
        pdfText,
        /(?:^|\|\s*)(?:total|montant\s+total)\s*[:|]?/i
      );
      if (genericTotal > 0) {
        montantHT = genericTotal;
      }
    }
  }

  const cleanHt = round2(Math.max(0, montantHT));
  return {
    montantHT: cleanHt,
    tvaRate: 0,
    montantTTC: cleanHt,
  };
}

const NON_VENDOR_LINE_RE =
  /^(?:facture(?:\s+n[°o].*)?|invoice(?:\s+#.*)?|devis|avoir|note\s+d['’]honoraires|original|duplicata|page\s+\d|date\b|[ée]ch[ée]ance\b|r[ée]f[ée]rence\b|objet\b|d[ée]signation\b|description\b|quantit[ée]\b|prix\b|montant\b|total\b|sous[- ]?total\b|tva\b|net\s+[àa]\s+payer\b|siret\b|siren\b|rcs\b|ape\b|naf\b|iban\b|bic\b|swift\b|rib\b|t[ée]l(?:[ée]phone)?\b|fax\b|email\b|e-?mail\b|site\b|web\b|adresse\b|client\b|factur[ée]\s+[àa]\b|destinataire\b|bill\s+to\b|ship\s+to\b|[àa]\s+l['’]attention\b|conditions?\s+de\s+(?:paiement|r[èe]glement)|mode\s+de\s+(?:paiement|r[èe]glement)|coordonn[ée]es\s+bancaires|capital\s+social|au\s+capital|mentions?\s+l[ée]gales?)/i;

const ADDRESS_OR_NOISE_RE =
  /^(?:\d{1,5}\s*(?:bis|ter)?\s*,?\s*(?:rue|avenue|av\.|boulevard|bd\.?|impasse|all[ée]e|place|chemin|route|cours|quai|square|passage|zone|za\b|zi\b|batiment|b[âa]t\.?|cs\b|bp\b)|(?:\d{5}\s+[A-Za-zÀ-ÿ])|france$|paris$|lyon$|marseille$|bordeaux$|nantes$|lille$|toulouse$|\+?\d[\d\s().-]{7,}$|https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$)/i;

const LEGAL_FORM_RE =
  /\b(SASU|SAS|SARL|EURL|SA|SNC|EI|EIRL|SCOP|SELARL|GIE|STUDIO|AGENCY|AGENCE|PRODUCTIONS?|PROD|MEDIA|CREATIVE|CONSULTING|GROUP|COLLECTIF|DIGITAL|LABS?|DESIGN|EVENTS?|COMMUNICATION|LTD|LLC|GMBH|INC)\b/i;

const CLIENT_SECTION_HEADER_RE =
  /^(?:factur[ée]\s+[àa]|client|destinataire|bill\s+to|billed\s+to|[àa]\s+l['’]attention\s+de|acheteur|adress[ée]\s+[àa])\b/i;

const GENERIC_EMAIL_DOMAINS = new Set([
  "gamersorigin.com",
  "lintrus.fr",
  "lintrus.com",
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.fr",
  "live.com",
  "yahoo.fr",
  "yahoo.com",
  "icloud.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "protonmail.com",
  "proton.me",
  "pennylane.com",
  "pennylane.tech",
  "qonto.com",
  "tiime.fr",
  "shine.fr",
  "freebe.me",
]);

function cleanVendorCandidate(raw: string): string {
  return raw
    .replace(/^(?:[ée]metteur|fournisseur|prestataire|vendeur|soci[ée]t[ée]|raison\s+sociale|titulaire(?:\s+du\s+compte)?)\s*[:|-]\s*/i, "")
    .replace(/\s*[-–|]\s*(?:siret|siren|tva|rcs|capital|t[ée]l|email).*$/i, "")
    .replace(/\s+au\s+capital\s+de.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractVendorName(params: {
  pdfText: string;
  filename: string;
  knownVendors?: readonly string[];
}): string {
  const { pdfText, filename, knownVendors = [] } = params;
  const normFull = normalizeAsciiLower(pdfText);

  // 1. Check against known project vendors (quotes / budgetLines.realisePar), excluding our own companies
  const uniqueKnown = Array.from(
    new Set(
      knownVendors
        .map((v) => v.trim())
        .filter((v) => v.length >= 3 && !isOwnCompanyName(v))
    )
  ).sort((a, b) => b.length - a.length);

  for (const known of uniqueKnown) {
    if (normFull.includes(normalizeAsciiLower(known))) {
      return known;
    }
  }

  // Split lines and also split two-column lines separated by " | "
  const rawLines = pdfText.split(/\r?\n/);

  // Identify lines belonging to the buyer/client block (GamersOrigin / L'Intrus)
  const ownLineIndices = new Set<number>();
  for (let i = 0; i < rawLines.length; i++) {
    if (isOwnCompanyName(rawLines[i])) {
      // Mark this line and following 3 address lines of that buyer block
      ownLineIndices.add(i);
      for (let k = 1; k <= 3 && i + k < rawLines.length; k++) {
        if (ADDRESS_OR_NOISE_RE.test(rawLines[i + k].trim())) {
          ownLineIndices.add(i + k);
        }
      }
    }
  }

  // 2. Explicit issuer labels ("Émetteur :", "Fournisseur :", "Prestataire :", "Titulaire du compte :")
  const explicitIssuerRe =
    /(?:[ée]metteur|fournisseur|prestataire|vendeur|titulaire(?:\s+du\s+compte)?)\s*[:]\s*([^\n|]{2,70})/gi;
  let em: RegExpExecArray | null;
  while ((em = explicitIssuerRe.exec(pdfText)) !== null) {
    const cand = cleanVendorCandidate(em[1]);
    if (
      cand.length >= 2 &&
      !isOwnCompanyName(cand) &&
      !NON_VENDOR_LINE_RE.test(cand) &&
      !ADDRESS_OR_NOISE_RE.test(cand)
    ) {
      return cand.slice(0, 80);
    }
  }

  // 3. Score top-header & column-separated candidates excluding GamersOrigin / L'Intrus
  const scored: Array<{ text: string; score: number }> = [];
  let inClientBlock = false;
  let clientBlockDepth = 0;

  for (let i = 0; i < Math.min(rawLines.length, 35); i++) {
    const rawLine = rawLines[i].trim();
    if (!rawLine) {
      if (inClientBlock) {
        clientBlockDepth++;
        if (clientBlockDepth > 2) inClientBlock = false;
      }
      continue;
    }

    // Two-column row (e.g. "Studio Vertigo SAS  |  Facturé à : GamersOrigin")
    const cols = rawLine
      .split(/\s+\|\s+/)
      .map((c) => c.trim())
      .filter(Boolean);

    if (cols.length > 1) {
      for (let cIdx = 0; cIdx < cols.length; cIdx++) {
        const col = cols[cIdx];
        if (isOwnCompanyName(col) || CLIENT_SECTION_HEADER_RE.test(col)) {
          continue;
        }
        const cand = cleanVendorCandidate(col);
        if (
          cand.length < 2 ||
          cand.length > 75 ||
          isOwnCompanyName(cand) ||
          NON_VENDOR_LINE_RE.test(cand) ||
          ADDRESS_OR_NOISE_RE.test(cand) ||
          /^\d[\d\s.,€/-]+$/.test(cand)
        ) {
          continue;
        }
        let score = 40 - i;
        if (cIdx === 0) score += 12; // Top-left is standard French issuer position
        if (LEGAL_FORM_RE.test(cand)) score += 30;
        if (i <= 5) score += 15;
        scored.push({ text: cand, score });
      }
      continue;
    }

    if (CLIENT_SECTION_HEADER_RE.test(rawLine)) {
      inClientBlock = true;
      clientBlockDepth = 0;
      continue;
    }

    if (inClientBlock) {
      clientBlockDepth++;
      if (isOwnCompanyName(rawLine) || clientBlockDepth <= 4) {
        continue;
      }
      inClientBlock = false;
    }

    if (ownLineIndices.has(i) || isOwnCompanyName(rawLine)) continue;

    const cand = cleanVendorCandidate(rawLine);
    if (
      cand.length < 2 ||
      cand.length > 75 ||
      isOwnCompanyName(cand) ||
      NON_VENDOR_LINE_RE.test(cand) ||
      ADDRESS_OR_NOISE_RE.test(cand) ||
      /^\d[\d\s.,€/-]+$/.test(cand) ||
      /^CP\s*\d{4,8}$/i.test(cand)
    ) {
      continue;
    }

    let score = 35 - i;
    if (LEGAL_FORM_RE.test(cand)) score += 32;
    if (i <= 4) score += 18;
    // Slight penalty for long sentences (> 6 words)
    const wordCount = cand.split(/\s+/).length;
    if (wordCount > 6) score -= 20;
    if (/[!?]/.test(cand)) score -= 25;

    scored.push({ text: cand, score });
  }

  // 4. Legal footer match: "SAS VERTIGO STUDIO au capital de ..." or "Studio Alpha - SIRET ..."
  const footerRe =
    /(?:^|\n)\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9&'’.\s-]{2,55}?)\s*(?:[-–•|]\s*(?:SASU?|SARL|EURL|SA|EI|SIRET|SIREN)|au\s+capital\s+de)/gim;
  let fm: RegExpExecArray | null;
  while ((fm = footerRe.exec(pdfText)) !== null) {
    const cand = cleanVendorCandidate(fm[1]);
    if (
      cand.length >= 2 &&
      !isOwnCompanyName(cand) &&
      !NON_VENDOR_LINE_RE.test(cand) &&
      !ADDRESS_OR_NOISE_RE.test(cand)
    ) {
      scored.push({ text: cand, score: 58 });
    }
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    return scored[0].text.slice(0, 80);
  }

  // 5. Non-generic supplier email domain fallback (excluding gamersorigin / lintrus / webmails)
  const emailRe = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi;
  let emDomain: RegExpExecArray | null;
  while ((emDomain = emailRe.exec(pdfText)) !== null) {
    const domain = emDomain[1].toLowerCase();
    if (GENERIC_EMAIL_DOMAINS.has(domain) || isOwnCompanyName(domain)) continue;
    const brand = domain.split(".")[0];
    if (brand && brand.length >= 3) {
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }

  // 6. Clean filename fallback (stripping invoice numbers, dates, CP codes, and own company names)
  const cleanedFilename = filename
    .replace(/\.pdf$/i, "")
    .replace(/\b(?:facture|invoice|fac|fa|inv|cp)\b/gi, " ")
    .replace(/\b20\d{2}[-_./]?\d{2}[-_./]?\d{2}\b/g, " ")
    .replace(/\b\d{4,10}\b/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanedFilename.length >= 3 && !isOwnCompanyName(cleanedFilename)) {
    return cleanedFilename.slice(0, 60);
  }

  return "";
}

export function extractProjectCodesFromText(params: {
  pdfText: string;
  filename: string;
  activeCodeProjet: string;
  knownProjectCodes?: readonly string[];
}): string[] {
  const { pdfText, filename, activeCodeProjet, knownProjectCodes = [] } = params;
  const combined = `${filename}\n${pdfText}`;
  const found: string[] = [];

  // 1. Explicit "CP 326027" / "Code projet : 326018" patterns
  const explicitCpRe =
    /(?:\bCP\b|code[\s_-]*projet|projet\s*n[°o]?)\s*[:#-]?\s*([0-9]{4,8}|[A-Z0-9]{2,4}-[0-9]{3,6})/gi;
  let m: RegExpExecArray | null;
  while ((m = explicitCpRe.exec(combined)) !== null) {
    if (m[1]) found.push(m[1].trim());
  }

  // 2. Match any known agency project code from DB appearing as a standalone token
  for (const code of knownProjectCodes) {
    const clean = code.trim();
    if (clean.length < 3) continue;
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokenRe = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`, "i");
    if (tokenRe.test(combined)) {
      found.push(clean);
    }
  }

  return normalizeProjectCodesList(found, activeCodeProjet);
}

export function extractPrestationSummary(pdfText: string): {
  prestationSummary: string;
  typeFacture: "ACOMPTE" | "SOLDE" | "UNIQUE";
} {
  let typeFacture: "ACOMPTE" | "SOLDE" | "UNIQUE" = "UNIQUE";
  if (/\bacompte\b|\bdeposit\b/i.test(pdfText)) {
    typeFacture = "ACOMPTE";
  } else if (/\bsolde\b|\bfacture\s+finale\b/i.test(pdfText)) {
    typeFacture = "SOLDE";
  }

  const lines = pdfText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. Explicit "Objet :" / "Intitulé :" / "Prestation :"
  const objetRe = /^(?:objet|intitul[ée]|prestation|projet|mission|libell[ée])\s*[:|-]\s*(.+)$/i;
  for (const line of lines) {
    const m = objetRe.exec(line);
    if (m?.[1]) {
      const clean = m[1].trim();
      if (clean.length >= 4 && !isOwnCompanyName(clean)) {
        return { prestationSummary: clean.slice(0, 90), typeFacture };
      }
    }
  }

  // 2. First descriptive line right below a table header ("Désignation" / "Description" / "Prestation")
  const tableHeaderRe = /(?:d[ée]signation|description|prestation|libell[ée]|article|service).*(?:qt[ée]|quantit|prix|montant|total|ht)/i;
  for (let i = 0; i < lines.length - 1; i++) {
    if (tableHeaderRe.test(lines[i])) {
      for (let k = 1; k <= 3 && i + k < lines.length; k++) {
        const candidate = lines[i + k]
          .split(/\s+\|\s+/)[0]
          .replace(/\s+\d[\d\s.,]*\s*(?:€|EUR|%)\b.*$/i, "")
          .trim();
        if (
          candidate.length >= 5 &&
          !NON_VENDOR_LINE_RE.test(candidate) &&
          !isOwnCompanyName(candidate) &&
          !/^\d[\d\s.,€/%-]+$/.test(candidate)
        ) {
          return { prestationSummary: candidate.slice(0, 90), typeFacture };
        }
      }
    }
  }

  return { prestationSummary: "Prestation", typeFacture };
}

export function matchQuoteForInvoice(
  quotes: ReadonlyArray<{
    id: string;
    quoteNumber: string;
    vendorName: string;
    amountHt: number;
    budgetLineId?: string | null;
  }>,
  params: {
    pdfText: string;
    vendorName: string;
    amountHt: number;
  }
): { id: string; budgetLineId: string | null } | null {
  if (quotes.length === 0) return null;

  const normText = normalizeAsciiLower(params.pdfText);
  const normVendor = normalizeAsciiLower(params.vendorName);

  // 1. Exact quote number referenced inside PDF
  for (const q of quotes) {
    const qNum = q.quoteNumber.trim();
    if (qNum.length >= 3 && normText.includes(normalizeAsciiLower(qNum))) {
      return { id: q.id, budgetLineId: q.budgetLineId ?? null };
    }
  }

  // 2. Vendor match + closest HT amount
  if (normVendor.length >= 3) {
    const vendorMatches = quotes.filter((q) => {
      const qv = normalizeAsciiLower(q.vendorName);
      return qv.length >= 3 && (qv.includes(normVendor) || normVendor.includes(qv));
    });
    if (vendorMatches.length === 1) {
      return {
        id: vendorMatches[0].id,
        budgetLineId: vendorMatches[0].budgetLineId ?? null,
      };
    }
    if (vendorMatches.length > 1 && params.amountHt > 0) {
      vendorMatches.sort(
        (a, b) =>
          Math.abs(a.amountHt - params.amountHt) -
          Math.abs(b.amountHt - params.amountHt)
      );
      return {
        id: vendorMatches[0].id,
        budgetLineId: vendorMatches[0].budgetLineId ?? null,
      };
    }
  }

  return null;
}

export interface LocalInvoiceExtractionResult extends InvoiceExtractionOutput {
  detectedProjectCodes: string[];
  suggestedQuoteId: string | null;
}

export function extractInvoiceFieldsFromText(params: {
  pdfText: string;
  filename: string;
  activeCodeProjet: string;
  knownProjectCodes?: readonly string[];
  budgetLines?: ReadonlyArray<{
    id: string;
    category: string;
    objet: string;
    realisePar?: string | null;
    preOpTotalHt?: number;
    postOpTotalHt?: number;
  }>;
  quotes?: ReadonlyArray<{
    id: string;
    quoteNumber: string;
    vendorName: string;
    amountHt: number;
    budgetLineId?: string | null;
  }>;
  warningReason?: string | null;
}): LocalInvoiceExtractionResult {
  const {
    pdfText,
    filename,
    activeCodeProjet,
    knownProjectCodes = [],
    budgetLines = [],
    quotes = [],
    warningReason,
  } = params;

  const knownVendors = [
    ...quotes.map((q) => q.vendorName),
    ...budgetLines.map((l) => l.realisePar ?? ""),
  ].filter(Boolean);

  const prestataire = extractVendorName({ pdfText, filename, knownVendors });
  const numeroFacture = extractInvoiceNumber(pdfText, filename);
  const dateFacture = extractIssueDate(pdfText, filename);
  const { montantHT, tvaRate, montantTTC } = extractAmounts(pdfText);
  const { prestationSummary, typeFacture } = extractPrestationSummary(pdfText);
  const detectedProjectCodes = extractProjectCodesFromText({
    pdfText,
    filename,
    activeCodeProjet,
    knownProjectCodes,
  });

  const matchedQuote = matchQuoteForInvoice(quotes, {
    pdfText,
    vendorName: prestataire,
    amountHt: montantHT,
  });

  // Compute confidence based on how many core fields were cleanly detected
  let filledScore = 0;
  if (prestataire) filledScore += 0.25;
  if (numeroFacture) filledScore += 0.25;
  if (montantHT > 0) filledScore += 0.3;
  if (dateFacture) filledScore += 0.1;
  if (prestationSummary && prestationSummary !== "Prestation") filledScore += 0.1;

  const rawWarnings: string[] = [];
  if (warningReason && filledScore < 0.8) {
    rawWarnings.push(warningReason);
  }

  return {
    prestataire: prestataire || "Prestataire à vérifier",
    numeroFacture,
    dateFacture,
    montantHT,
    tvaRate,
    montantTTC,
    typeFacture,
    codeProjetDetecte: detectedProjectCodes[0] ?? activeCodeProjet,
    detectedProjectCodes,
    prestationSummary,
    suggestedBudgetLineId: matchedQuote?.budgetLineId ?? null,
    suggestedBudgetLineLabel: null,
    suggestedQuoteId: matchedQuote?.id ?? null,
    confidence: round2(Math.max(0.25, filledScore)),
    extractedRawTextSnippet: pdfText.slice(0, 800),
    rawWarnings,
  };
}
