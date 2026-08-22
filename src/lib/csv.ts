import { DAY_LABELS, DAY_ORDER } from "@/lib/days";
import type { DayOfWeek } from "@prisma/client";

/** Parses CSV text into rows of raw string fields, handling quoted fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; the following \n (if any) closes the row
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** Converts parsed CSV rows into objects keyed by the (trimmed) header row. */
export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
}

/** Reads a File from FormData as CSV objects keyed by header row. */
export async function readCsvFile(file: FormDataEntryValue | null): Promise<Record<string, string>[]> {
  if (!(file instanceof File) || file.size === 0) return [];
  const text = await file.text();
  return csvRowsToObjects(parseCsv(text));
}

/** Builds CSV rows for one timetable as a day-column × period-row grid
 * (day header row, then one row per period), matching the on-screen
 * ScheduleGridTable layout rather than a flat one-row-per-lesson list —
 * this is what makes the download actually look like a timetable when
 * opened in spreadsheet software. Each cell's lines (e.g. subject/teacher/
 * room) are joined with newlines within the one CSV field. */
export function scheduleGridToCsvRows(
  timeSlots: { id: string; dayOfWeek: DayOfWeek; periodNumber: number }[],
  cellLines: (slotId: string) => string[] | null
): string[][] {
  const periods = [...new Set(timeSlots.map((s) => s.periodNumber))].sort((a, b) => a - b);
  const days = DAY_ORDER.filter((d) => timeSlots.some((s) => s.dayOfWeek === d));
  const slotByDayPeriod = new Map(timeSlots.map((s) => [`${s.dayOfWeek}-${s.periodNumber}`, s]));

  const rows: string[][] = [["", ...days.map((d) => DAY_LABELS[d])]];
  for (const period of periods) {
    const row: string[] = [`${period}限`];
    for (const day of days) {
      const slot = slotByDayPeriod.get(`${day}-${period}`);
      const lines = slot ? cellLines(slot.id) : null;
      row.push(lines ? lines.join("\n") : "");
    }
    rows.push(row);
  }
  return rows;
}

/** Serializes rows into CSV text (CRLF lines, UTF-8 BOM so Excel opens
 * Japanese text correctly without a manual encoding step). */
export function toCsv(rows: string[][]): string {
  const escapeField = (field: string) =>
    /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
  const body = rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
  return String.fromCharCode(0xfeff) + body + "\r\n";
}

/** Builds Content-Type/Content-Disposition headers for a CSV file download.
 * HTTP header values must be ASCII, so a non-ASCII filename (e.g. Japanese)
 * can't go directly in `filename=`— it's passed only via the RFC 5987
 * `filename*=UTF-8''...` form, with a plain ASCII fallback name for clients
 * that don't support it. */
export function csvDownloadHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="download.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}
