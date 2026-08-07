import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { COLUMNS, parseTineScore, sortSeries } from "./columns.js";

const SCORE_FILLS = [
  { min: 90, max: 100, argb: "FF1B7A3A" },
  { min: 80, max: 89, argb: "FF7CB342" },
  { min: 70, max: 79, argb: "FFF9A825" },
  { min: 60, max: 69, argb: "FFEF6C00" },
  { min: 0, max: 59, argb: "FFC62828" },
];

function scoreFill(score) {
  const n = parseTineScore(score);
  const hit = SCORE_FILLS.find((b) => n >= b.min && n <= b.max);
  return hit ? hit.argb : "FF9E9E9E";
}

export async function seriesToWorkbook(list) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tines Romantasy Liste";
  const ws = wb.addWorksheet("Hele TBR");
  ws.addRow(COLUMNS);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFF5E6C8" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1A2238" },
  };
  header.alignment = { vertical: "middle", wrapText: true };

  const sorted = sortSeries(list);
  for (const row of sorted) {
    const values = COLUMNS.map((c) => row[c] ?? "");
    const excelRow = ws.addRow(values);
    for (const key of ["Tine-score", "Indholdsmatch", "Læseprioritet nu"]) {
      const scoreCol = COLUMNS.indexOf(key) + 1;
      const cell = excelRow.getCell(scoreCol);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: scoreFill(row[key]) },
      };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  COLUMNS.forEach((_, i) => {
    let max = 12;
    ws.getColumn(i + 1).eachCell({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = Math.min(len + 2, 42);
    });
    ws.getColumn(i + 1).width = max;
  });

  for (let r = 2; r <= ws.rowCount; r++) {
    if (r % 2 === 0) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => {
        if (
          ["Tine-score", "Indholdsmatch", "Læseprioritet nu"].some(
            (key) => col === COLUMNS.indexOf(key) + 1
          )
        ) {
          return;
        }
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF7F1E8" },
        };
      });
    }
  }

  return wb;
}

export async function workbookToSeries(bufferOrPath) {
  // SheetJS håndterer også lidt “skæve” ChatGPT-xlsx-filer
  const data =
    typeof bufferOrPath === "string"
      ? readFileSync(bufferOrPath)
      : Buffer.isBuffer(bufferOrPath)
        ? bufferOrPath
        : Buffer.from(bufferOrPath);

  const wb = XLSX.read(data, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames.includes("Hele TBR")
    ? "Hele TBR"
    : wb.SheetNames[0];
  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: null,
    raw: false,
  });

  const numericKeys = [
    "Tine-score",
    "Indholdsmatch",
    "Læseprioritet nu",
    "Tines score",
    "Goodreads-score",
    "Book hangover (0-5)",
    "Worldbuilding (0-5)",
    "Episk plot (0-5)",
    "Politiske intriger (0-5)",
    "Krig/militær (0-5)",
    "Kvindelig udvikling (0-5)",
    "Karakterudvikling (0-5)",
    "Beskyttende helt(e) (0-5)",
    "Bodyguard-vibe (0-5)",
    "Touch her and die-vibe (0-5)",
    "Spice/erotik (0-5)",
    "Spice/erotik kvalitet (0-5)",
    "Rhysand-faktoren",
  ];

  const list = rows
    .map((raw) => {
      const obj = Object.fromEntries(COLUMNS.map((c) => [c, null]));
      for (const col of COLUMNS) {
        if (raw[col] !== undefined && raw[col] !== "") obj[col] = raw[col];
      }
      for (const key of numericKeys) {
        if (obj[key] != null && obj[key] !== "" && !Number.isNaN(Number(obj[key]))) {
          obj[key] = Number(obj[key]);
        }
      }
      return obj;
    })
    .filter((r) => r["Seriens navn"]);

  return sortSeries(list);
}
