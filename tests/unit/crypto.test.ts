import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CryptoDecryptionError,
  CryptoKeyError,
  clearCryptoKeyCacheForTests,
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@/lib/crypto";

describe("crypto (AES-256-GCM)", () => {
  let tempDir: string;
  const origEnvKey = process.env.APP_ENCRYPTION_KEY;
  const origMasterPath = process.env.MASTER_KEY_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-crypto-test-"));
    delete process.env.APP_ENCRYPTION_KEY;
    process.env.MASTER_KEY_PATH = path.join(tempDir, ".data", "master.key");
    clearCryptoKeyCacheForTests();
  });

  afterEach(() => {
    if (origEnvKey !== undefined) {
      process.env.APP_ENCRYPTION_KEY = origEnvKey;
    } else {
      delete process.env.APP_ENCRYPTION_KEY;
    }
    if (origMasterPath !== undefined) {
      process.env.MASTER_KEY_PATH = origMasterPath;
    } else {
      delete process.env.MASTER_KEY_PATH;
    }
    clearCryptoKeyCacheForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("auto-creates .data/master.key and round-trips secrets across cache clears", () => {
    const payload = encryptSecret("ya29.super-secret-oauth-token");
    expect(payload.startsWith("v1:")).toBe(true);
    expect(fs.existsSync(process.env.MASTER_KEY_PATH!)).toBe(true);

    clearCryptoKeyCacheForTests();
    expect(decryptSecret(payload)).toBe("ya29.super-secret-oauth-token");
  });

  it("rejects tampered ciphertext or wrong APP_ENCRYPTION_KEY", () => {
    process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
    clearCryptoKeyCacheForTests();
    const payload = encryptSecret("gemini-secret-key");

    const parts = payload.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:AAAA${parts[3].slice(4)}`;
    expect(() => decryptSecret(tampered)).toThrow(CryptoDecryptionError);

    process.env.APP_ENCRYPTION_KEY = "b".repeat(64);
    clearCryptoKeyCacheForTests();
    expect(() => decryptSecret(payload)).toThrow(CryptoDecryptionError);
  });

  it("throws CryptoKeyError on corrupted master.key file", () => {
    fs.mkdirSync(path.dirname(process.env.MASTER_KEY_PATH!), { recursive: true });
    fs.writeFileSync(process.env.MASTER_KEY_PATH!, "not-a-64-hex-key", "utf8");
    clearCryptoKeyCacheForTests();
    expect(() => encryptSecret("test")).toThrow(CryptoKeyError);
  });

  it("masks secrets safely without exposing raw middle characters across lengths 0..14", () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
    expect(maskSecret("")).toBeNull();
    expect(maskSecret("   ")).toBeNull();

    // Lengths 1..8 must never reveal any raw characters
    for (let len = 1; len <= 8; len++) {
      const secret = "1234567890".slice(0, len);
      expect(maskSecret(secret)).toBe("••••");
    }

    // Lengths 9..12 reveal at most 2 prefix + 2 suffix chars
    expect(maskSecret("123456789")).toBe("12••••89");
    expect(maskSecret("1234567890")).toBe("12••••90");
    expect(maskSecret("12345678901")).toBe("12••••01");
    expect(maskSecret("123456789012")).toBe("12••••12");

    // Lengths > 12 reveal 4 prefix + 4 suffix chars
    expect(maskSecret("1234567890123")).toBe("1234••••0123");
    expect(maskSecret("12345678901234")).toBe("1234••••1234");
    expect(maskSecret("AIzaSyD1234567890XYZ")).toBe("AIza••••0XYZ");
  });
});
