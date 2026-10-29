// Export helpers: PNG image of a chart, print/PDF (A4 landscape), CSV and Excel.

import { formatDateTime } from "./format";

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Saves the first <svg> inside `container` as a PNG with a title line. */
export async function exportChartPng(
  container: HTMLElement,
  title: string,
  fileName: string,
  legend: { label: string; color: string }[] = [],
) {
  const svg = container.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // Web fonts are not available inside an exported image; use a Hebrew-capable system font.
  clone.setAttribute("font-family", "Arial, 'Noto Sans Hebrew', sans-serif");
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  await img.decode();
  const scale = 2;
  const header = legend.length ? 84 : 56;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil((height + header) * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height + header);
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#1d2430";
  ctx.font = "bold 18px Heebo, Arial, sans-serif";
  ctx.fillText(title, width - 12, 24);
  ctx.font = "13px Heebo, Arial, sans-serif";
  ctx.fillStyle = "#4a5565";
  ctx.fillText(`נוצר: ${formatDateTime(Date.now())}`, width - 12, 44);
  // Legend, right to left.
  let x = width - 12;
  ctx.font = "13px Heebo, Arial, sans-serif";
  for (const item of legend) {
    ctx.fillStyle = item.color;
    ctx.fillRect(x - 12, 62, 12, 12);
    ctx.fillStyle = "#4a5565";
    ctx.fillText(item.label, x - 18, 73);
    x -= 18 + ctx.measureText(item.label).width + 16;
  }
  ctx.drawImage(img, 0, header, width, height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (blob) download(blob, fileName);
}

const PRINT_CSS = `
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: Heebo, Arial, sans-serif; color: #1d2430; direction: rtl; margin: 0; font-size: 11pt; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin: 14pt 0 6pt; break-after: avoid; }
.meta { color: #4a5565; margin-bottom: 10pt; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; break-inside: auto; }
th, td { border: 1px solid #c9ced8; padding: 3pt 5pt; text-align: right; vertical-align: top; }
th { background: #eef4ff; }
tr { break-inside: avoid; }
.num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
.chart svg { max-width: 100%; height: auto; }
.note { color: #4a5565; font-size: 9pt; }
`;

/** Opens the browser print dialog (choose "Save as PDF") for an A4-landscape RTL document. */
export function printDocument(title: string, bodyHtml: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap" rel="stylesheet">` +
      `<style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();
  const go = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 60_000);
  };
  // Give the web font a moment to load so Hebrew prints in the app font.
  setTimeout(go, 600);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type Table = { name: string; headers: string[]; rows: (string | number | null | undefined)[][] };

export function tableToHtml(t: Table): string {
  const head = `<tr>${t.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const body = t.rows
    .map((r) => `<tr>${r.map((c) => (typeof c === "number" ? `<td class="num">${c}</td>` : `<td>${escapeHtml(String(c ?? ""))}</td>`)).join("")}</tr>`)
    .join("");
  return `<h2>${escapeHtml(t.name)}</h2><table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** CSV with a UTF-8 BOM so Excel shows Hebrew correctly. */
export function downloadCsv(t: Table, fileName: string, meta: string[] = []) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [...meta.map((m) => esc(m)), t.headers.map(esc).join(","), ...t.rows.map((r) => r.map(esc).join(","))];
  download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), fileName);
}

/** Excel workbook (one sheet per table), right-to-left, with report title and dates. */
export async function downloadXlsx(tables: Table[], fileName: string, meta: string[]) {
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const sheets = tables.map((t) => {
    const data = [
      ...meta.map((m) => [{ value: m, fontWeight: "bold" as const }]),
      [],
      t.headers.map((h) => ({ value: h, fontWeight: "bold" as const, backgroundColor: "#EEF4FF" })),
      ...t.rows.map((r) => r.map((c) => (c === null || c === undefined ? null : { value: c }))),
    ];
    return {
      data,
      sheet: t.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "),
      rightToLeft: true,
      orientation: "landscape" as const,
      columns: t.headers.map((h) => ({ width: Math.max(10, Math.min(40, h.length + 6)) })),
    };
  });
  const blob = await writeExcelFile(sheets as never).toBlob();
  download(blob, fileName);
}
