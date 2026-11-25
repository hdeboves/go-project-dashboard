import zlib from "node:zlib";
import { AppHttpError } from "@/lib/errors";

export function validatePdfBuffer(
  buffer: Buffer,
  mimeType?: string | null,
  filename?: string | null
): void {
  const normalizedMime = (mimeType ?? "").toLowerCase().trim();
  if (
    normalizedMime &&
    normalizedMime !== "application/pdf" &&
    normalizedMime !== "application/x-pdf" &&
    normalizedMime !== "application/octet-stream"
  ) {
    throw new AppHttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      `Type de fichier non supporté (${mimeType}). Seuls les fichiers PDF sont acceptés.`
    );
  }

  if (
    normalizedMime === "application/octet-stream" &&
    filename &&
    !/\.pdf$/i.test(filename.trim())
  ) {
    throw new AppHttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Le fichier fourni doit porter l'extension .pdf."
    );
  }

  if (!buffer || buffer.length < 12) {
    throw new AppHttpError(
      422,
      "INVALID_PDF_FILE",
      "Fichier PDF vide ou tronqué."
    );
  }

  const head = buffer.subarray(0, Math.min(1024, buffer.length));
  if (head.indexOf("%PDF-") === -1) {
    throw new AppHttpError(
      422,
      "INVALID_PDF_FILE",
      "Fichier PDF invalide : en-tête %PDF- manquant."
    );
  }

  const hasEof = buffer.includes("%%EOF");
  const hasObjects = buffer.includes("obj") && buffer.includes("endobj");
  const hasXref = buffer.includes("xref") || buffer.includes("startxref");
  const hasTextOperators =
    buffer.includes(") Tj") ||
    buffer.includes(")Tj") ||
    buffer.includes("] TJ") ||
    buffer.includes("]TJ");

  if (!hasEof && !hasObjects && !hasXref && !hasTextOperators) {
    throw new AppHttpError(
      422,
      "INVALID_PDF_FILE",
      "Structure PDF corrompue ou incomplète."
    );
  }
}

function unescapePdfLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const esc = raw[i];
    if (esc === "n") out += "\n";
    else if (esc === "r") out += "\r";
    else if (esc === "t") out += "\t";
    else if (esc === "b") out += "\b";
    else if (esc === "f") out += "\f";
    else if (esc === "(" || esc === ")" || esc === "\\") out += esc;
    else if (esc === "\r" || esc === "\n") {
      // line continuation
      if (esc === "\r" && raw[i + 1] === "\n") i++;
    } else if (/[0-7]/.test(esc)) {
      let oct = esc;
      for (let k = 0; k < 2 && i + 1 < raw.length && /[0-7]/.test(raw[i + 1]); k++) {
        oct += raw[++i];
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += esc;
    }
  }
  return out;
}

function extractTextOperatorsFromChunk(chunk: string): string[] {
  const parts: string[] = [];

  // Match literal strings (...) followed by Tj or inside [...] TJ
  let i = 0;
  const len = chunk.length;
  while (i < len) {
    if (chunk[i] === "(") {
      let depth = 1;
      const start = i + 1;
      i++;
      let literal = "";
      while (i < len && depth > 0) {
        if (chunk[i] === "\\" && i + 1 < len) {
          literal += chunk[i] + chunk[i + 1];
          i += 2;
          continue;
        }
        if (chunk[i] === "(") {
          depth++;
          literal += "(";
        } else if (chunk[i] === ")") {
          depth--;
          if (depth > 0) literal += ")";
        } else {
          literal += chunk[i];
        }
        i++;
      }
      // Look ahead for Tj or TJ context within short window
      const ahead = chunk.slice(i, i + 40);
      if (/^\s*(Tj|'|")/.test(ahead) || /\]\s*TJ/.test(ahead) || chunk.slice(Math.max(0, start - 60), start).includes("[")) {
        const decoded = unescapePdfLiteral(literal).trim();
        if (decoded) parts.push(decoded);
      }
      continue;
    }
    i++;
  }

  return parts;
}

export function extractTextFromPdfBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) return "";

  const collected: string[] = [];
  const rawLatin1 = buffer.toString("latin1");

  // 1. Extract from uncompressed text operators in raw PDF
  collected.push(...extractTextOperatorsFromChunk(rawLatin1));

  // 2. Decompress /FlateDecode streams and extract text operators
  let searchOffset = 0;
  while (searchOffset < buffer.length) {
    const streamIdx = buffer.indexOf("stream", searchOffset);
    if (streamIdx === -1) break;

    // Check preceding dictionary (last 512 bytes) for FlateDecode
    const dictStart = Math.max(0, streamIdx - 512);
    const dictSlice = buffer.subarray(dictStart, streamIdx).toString("latin1");

    let dataStart = streamIdx + 6;
    if (buffer[dataStart] === 0x0d && buffer[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (buffer[dataStart] === 0x0a || buffer[dataStart] === 0x0d) {
      dataStart += 1;
    }

    const endStreamIdx = buffer.indexOf("endstream", dataStart);
    if (endStreamIdx === -1) break;

    let dataEnd = endStreamIdx;
    while (
      dataEnd > dataStart &&
      (buffer[dataEnd - 1] === 0x0a || buffer[dataEnd - 1] === 0x0d)
    ) {
      dataEnd--;
    }

    if (dictSlice.includes("FlateDecode") && dataEnd > dataStart) {
      const compressed = buffer.subarray(dataStart, dataEnd);
      try {
        const inflated = zlib.inflateSync(compressed);
        const text = inflated.toString("latin1");
        collected.push(...extractTextOperatorsFromChunk(text));
      } catch {
        try {
          const inflatedRaw = zlib.inflateRawSync(compressed);
          const text = inflatedRaw.toString("latin1");
          collected.push(...extractTextOperatorsFromChunk(text));
        } catch {
          // Ignore non-deflate or corrupted stream segments
        }
      }
    }

    searchOffset = endStreamIdx + 9;
  }

  const joined = collected.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length > 0) {
    return joined;
  }

  // Fallback: extract printable ASCII/Latin1 sequences excluding PDF structural tokens
  const printableMatches = rawLatin1.match(
    /[A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ\s.,:;/_€$#@-]{3,}/g
  );
  if (!printableMatches) return "";

  const structuralNoise =
    /^(PDF-\d|obj|endobj|stream|endstream|xref|trailer|startxref|FlateDecode|Type|Catalog|Pages|Page|Font|Subtype|Type1|Helvetica|Resources|ProcSet|MediaBox|Contents)$/i;

  return printableMatches
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !structuralNoise.test(s))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
