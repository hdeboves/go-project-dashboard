import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class CryptoKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoKeyError";
  }
}

export class CryptoDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoDecryptionError";
  }
}

interface CachedKey {
  sourceSignature: string;
  key: Buffer;
}

let cachedKey: CachedKey | null = null;

function resolveMasterKey(): Buffer {
  const envRaw = process.env.APP_ENCRYPTION_KEY?.trim() ?? "";
  const keyPath =
    process.env.MASTER_KEY_PATH?.trim() ||
    path.join(process.cwd(), ".data", "master.key");

  const sourceSignature = envRaw ? `env:${envRaw}` : `file:${keyPath}`;

  if (cachedKey && cachedKey.sourceSignature === sourceSignature) {
    return cachedKey.key;
  }

  let key: Buffer;

  if (envRaw) {
    if (/^[0-9a-fA-F]{64}$/.test(envRaw)) {
      key = Buffer.from(envRaw, "hex");
    } else {
      const maybeB64 = Buffer.from(envRaw, "base64");
      if (maybeB64.length === 32 && envRaw.length >= 43) {
        key = maybeB64;
      } else {
        key = crypto.createHash("sha256").update(envRaw, "utf8").digest();
      }
    }
  } else {
    if (fs.existsSync(/*turbopackIgnore: true*/ keyPath)) {
      const hex = fs.readFileSync(/*turbopackIgnore: true*/ keyPath, "utf8").trim();
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new CryptoKeyError(
          `Invalid master key format in ${keyPath} (expected 64 hex chars)`
        );
      }
      key = Buffer.from(hex, "hex");
    } else {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      const hex = crypto.randomBytes(32).toString("hex");
      try {
        fs.writeFileSync(keyPath, hex, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        key = Buffer.from(hex, "hex");
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr?.code === "EEXIST") {
          const existingHex = fs.readFileSync(/*turbopackIgnore: true*/ keyPath, "utf8").trim();
          if (!/^[0-9a-fA-F]{64}$/.test(existingHex)) {
            throw new CryptoKeyError(
              `Invalid master key format in ${keyPath} (expected 64 hex chars)`
            );
          }
          key = Buffer.from(existingHex, "hex");
        } else {
          throw err;
        }
      }
    }
  }

  cachedKey = { sourceSignature, key };
  return key;
}

export function clearCryptoKeyCacheForTests(): void {
  cachedKey = null;
}

export function encryptSecret(plaintext: string): string {
  const key = resolveMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload || typeof payload !== "string") {
    throw new CryptoDecryptionError("Empty or invalid encrypted payload");
  }
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new CryptoDecryptionError("Unsupported or malformed encrypted payload format");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;

  try {
    iv = Buffer.from(ivB64, "base64");
    authTag = Buffer.from(tagB64, "base64");
    ciphertext = Buffer.from(dataB64, "base64");
  } catch {
    throw new CryptoDecryptionError("Malformed base64 segment in encrypted payload");
  }

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new CryptoDecryptionError("Invalid IV or authTag length");
  }

  const key = resolveMasterKey();
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new CryptoDecryptionError(
      err instanceof Error ? `Decryption failed: ${err.message}` : "Decryption failed"
    );
  }
}

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret || secret.trim().length === 0) {
    return null;
  }
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return "••••";
  }
  if (trimmed.length <= 12) {
    return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
