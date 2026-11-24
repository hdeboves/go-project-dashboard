import { describe, expect, it } from "vitest";
import {
  CpConflictError,
  assertNoCpConflict,
  checkCodeProjetConflict,
} from "@/lib/isolation/cp-guard";

describe("Zero-Mix CP Guard (cp-guard.ts)", () => {
  it("blocks mismatched extracted CP and filename-embedded CP like QF08_326018.pdf", () => {
    const r1 = checkCodeProjetConflict("326027", "326018", "");
    expect(r1.hasConflict).toBe(true);
    expect(r1.detectedCps).toContain("326018");

    const r2 = checkCodeProjetConflict("326027", null, "Facture QF08_326018.pdf");
    expect(r2.hasConflict).toBe(true);
    expect(r2.detectedCps).toEqual(["326018"]);

    const r3 = checkCodeProjetConflict("326027", null, "Objet: Facture | CP 326018");
    expect(r3.hasConflict).toBe(true);

    const r4 = checkCodeProjetConflict("326027", null, "Ref CP:326018");
    expect(r4.hasConflict).toBe(true);

    const r5 = checkCodeProjetConflict("326027", null, "CP 326027 & CP 326018");
    expect(r5.hasConflict).toBe(true);
    expect(r5.conflictingCps).toEqual(["326018"]);
  });

  it("allows matching CP with whitespace/prefix and ignores SIRET/dates/postal codes", () => {
    const ok1 = checkCodeProjetConflict("326027", " CP 326027 ", "Facture 326027");
    expect(ok1.hasConflict).toBe(false);
    expect(ok1.detectedCps).toEqual(["326027"]);

    const ok2 = checkCodeProjetConflict("326027", "   ", "");
    expect(ok2.hasConflict).toBe(false);
    expect(ok2.detectedCps).toEqual([]);

    const ok3 = checkCodeProjetConflict(
      "326027",
      null,
      "SIRET 12345678901234 Date 20260911 75011 Paris Tel 0145678901"
    );
    expect(ok3.hasConflict).toBe(false);
    expect(ok3.detectedCps).toEqual([]);
  });

  it("throws CpConflictError with HTTP 409 on assertNoCpConflict", () => {
    expect(() =>
      assertNoCpConflict("326027", null, "Devis Cristaline QF08_326018.pdf")
    ).toThrow(CpConflictError);

    try {
      assertNoCpConflict("326027", "326018", "");
    } catch (err) {
      expect(err).toBeInstanceOf(CpConflictError);
      expect((err as CpConflictError).statusCode).toBe(409);
      expect((err as CpConflictError).code).toBe("CP_CONFLICT");
    }
  });

  it("does not treat 'Projet 2026' or 'projet 2025' years as conflicting CPs while catching explicit Projet: CP", () => {
    const ok2026 = checkCodeProjetConflict(
      "326027",
      "326027",
      "Facture Prestation Projet 2026 - Caisse d'Epargne Fortnite"
    );
    expect(ok2026.hasConflict).toBe(false);
    expect(ok2026.detectedCps).toEqual(["326027"]);

    const ok2025 = checkCodeProjetConflict(
      "326027",
      "326027",
      "Budget projet 2025 - CP 326027"
    );
    expect(ok2025.hasConflict).toBe(false);
    expect(ok2025.detectedCps).toEqual(["326027"]);

    const okColonYear = checkCodeProjetConflict(
      "326027",
      "326027",
      "Projet: 2026 - CP 326027"
    );
    expect(okColonYear.hasConflict).toBe(false);

    const explicitConflict = checkCodeProjetConflict(
      "326027",
      null,
      "Projet: 326018"
    );
    expect(explicitConflict.hasConflict).toBe(true);
    expect(explicitConflict.conflictingCps).toEqual(["326018"]);
  });

  it("detects cross-prefix non-32xxxx CPs in filenames while avoiding SIRET/date/postal/decimal false positives", () => {
    const cross1 = checkCodeProjetConflict("326027", null, "Facture QF08_410088.pdf");
    expect(cross1.hasConflict).toBe(true);
    expect(cross1.conflictingCps).toEqual(["410088"]);

    const cross2 = checkCodeProjetConflict("410099", null, "Facture QF08_550088.pdf");
    expect(cross2.hasConflict).toBe(true);
    expect(cross2.conflictingCps).toEqual(["550088"]);

    const cross3 = checkCodeProjetConflict(
      "326027",
      null,
      "2026-11-24_410088_Studio_1000EUR.pdf"
    );
    expect(cross3.hasConflict).toBe(true);
    expect(cross3.conflictingCps).toEqual(["410088"]);

    const nonFalsePositives = checkCodeProjetConflict(
      "326027",
      "326027",
      "Facture_20260911.pdf SIRET_12345678901234.pdf CP_75011.pdf Montant total HT : 326018.00 EUR Tel 06 32 60 18 90"
    );
    expect(nonFalsePositives.hasConflict).toBe(false);
    expect(nonFalsePositives.detectedCps).toEqual(["326027"]);

    const blankActive = checkCodeProjetConflict("", null, "CP 326018");
    expect(blankActive.hasConflict).toBe(true);
    expect(blankActive.conflictingCps).toEqual(["326018"]);
  });
});
