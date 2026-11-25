import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { AppHttpError } from "@/lib/errors";
import {
  computeFortniteSummary,
  normalizeStrictIsoDate,
  parseFortniteReport,
} from "@/lib/reporting/fortnite-parser";

function buildFakePngBuffer(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dummy = deflateSync(Buffer.from("hello"));
  return Buffer.concat([sig, Buffer.alloc(16), dummy]);
}

describe("M4 Fortnite Creator Portal CSV/XLSX Parser & KPI Summary", () => {
  it("parses comma-separated CSV and computes exact campaign summary", async () => {
    const csv = [
      "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent",
      "2026-09-01,12400,18500,1140,24.5,920",
      "2026-09-02,15800,23100,1260,27.0,1340",
      "Total,28200,41600,1200,25.75,1340",
    ].join("\n");

    const parsed = await parseFortniteReport(
      Buffer.from(csv, "utf8"),
      "fortnite.csv",
      "text/csv"
    );

    expect(parsed.sourceType).toBe("FORTNITE_CSV");
    expect(parsed.rows).toHaveLength(2);

    const summary = computeFortniteSummary(parsed.rows);
    expect(summary.totalUniquePlayers).toBe(28200);
    expect(summary.totalSessions).toBe(41600);
    expect(summary.avgPlaytimeSec).toBe(1200);
    expect(summary.avgRetentionD1).toBe(25.75);
    expect(summary.maxPeakConcurrent).toBe(1340);
  });

  it("parses French semicolon CSV with UTF-8 BOM and quoted fields", async () => {
    const bom = "\uFEFF";
    const csv =
      bom +
      [
        '"Date";"Joueurs Uniques";"Sessions";"Temps moyen (min)";"Rétention J1 (%)";"Pic simultané"',
        '"2026-09-01";12400;18500;"19:00";"24,5%";920',
      ].join("\n");

    const parsed = await parseFortniteReport(
      Buffer.from(csv, "utf8"),
      "fortnite_fr.csv",
      "text/csv"
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      date: "2026-09-01",
      uniquePlayers: 12400,
      sessions: 18500,
      avgPlaytimeSec: 1140,
      retentionD1: 24.5,
      peakConcurrent: 920,
    });
  });

  it("parses XLSX workbook via exceljs", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fortnite Creator Portal");
    ws.addRow([
      "Date",
      "Unique Players",
      "Sessions",
      "Avg Playtime (s)",
      "Retention D1 (%)",
      "Peak Concurrent",
    ]);
    ws.addRow(["2026-09-01", 1000, 1500, 900, 22.4, 150]);
    ws.addRow(["2026-09-02", 2000, 3000, 1100, 28.6, 300]);

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await parseFortniteReport(
      buf,
      "creator.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    expect(parsed.sourceType).toBe("FORTNITE_XLSX");
    expect(parsed.rows).toHaveLength(2);
    expect(computeFortniteSummary(parsed.rows).totalUniquePlayers).toBe(3000);
  });

  it("rejects invalid calendar dates like 2026-02-30 atomically", async () => {
    expect(normalizeStrictIsoDate("2026-02-30")).toBeNull();
    expect(normalizeStrictIsoDate("2026-02-28")).toBe("2026-02-28");

    const csv = [
      "date,unique_players,sessions,avg_playtime_sec,retention_d1,peak_concurrent",
      "2026-09-01,100,200,600,20,50",
      "2026-02-30,100,200,600,20,50",
    ].join("\n");

    await expect(
      parseFortniteReport(Buffer.from(csv, "utf8"), "bad_date.csv", "text/csv")
    ).rejects.toThrow(AppHttpError);
  });

  it("rejects empty files, header-only files, negative metrics, retention > 100, and PNG-as-XLSX", async () => {
    await expect(
      parseFortniteReport(Buffer.alloc(0), "empty.csv", "text/csv")
    ).rejects.toThrow(AppHttpError);

    await expect(
      parseFortniteReport(
        Buffer.from("date,unique_players,sessions\n", "utf8"),
        "header.csv",
        "text/csv"
      )
    ).rejects.toThrow(AppHttpError);

    await expect(
      parseFortniteReport(
        Buffer.from("date,unique_players\n2026-09-01,-5\n", "utf8"),
        "neg.csv",
        "text/csv"
      )
    ).rejects.toThrow(AppHttpError);

    await expect(
      parseFortniteReport(
        Buffer.from("date,unique_players,retention_d1\n2026-09-01,100,120\n", "utf8"),
        "ret.csv",
        "text/csv"
      )
    ).rejects.toThrow(AppHttpError);

    await expect(
      parseFortniteReport(
        buildFakePngBuffer(),
        "fake.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).rejects.toThrow(AppHttpError);
  });

  it("returns finite zeroes for empty Fortnite summary", () => {
    const empty = computeFortniteSummary([]);
    expect(empty.totalUniquePlayers).toBe(0);
    expect(empty.avgRetentionD1).toBe(0);
    expect(Number.isFinite(empty.avgPlaytimeSec)).toBe(true);
  });
});
