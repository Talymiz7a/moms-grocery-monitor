// Renders a fictional demo receipt as an SVG image so every demo receipt has
// an "original file" that can be opened from the app.

import type { DemoReceipt } from "./demoData";

const W = 420;
const PAD = 22;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderReceiptSvg(r: DemoReceipt): string {
  const rows: string[] = [];
  let y = 44;
  const right = W - PAD;
  const text = (s: string, opts: { x?: number; anchor?: "start" | "end" | "middle"; size?: number; weight?: number } = {}) => {
    const x = opts.x ?? right;
    rows.push(
      `<text x="${x}" y="${y}" direction="rtl" text-anchor="${opts.anchor ?? "start"}" font-size="${opts.size ?? 15}" font-weight="${opts.weight ?? 400}">${esc(s)}</text>`,
    );
  };
  const amount = (agorot: number) => {
    rows.push(`<text x="${PAD}" y="${y}" direction="ltr" text-anchor="start" font-size="15">${(agorot / 100).toFixed(2)}</text>`);
  };
  const rule = () => {
    rows.push(`<line x1="${PAD}" x2="${right}" y1="${y - 6}" y2="${y - 6}" stroke="#555" stroke-dasharray="4 3"/>`);
    y += 14;
  };

  const torn = r.imageStyle === "torn";
  const missingTop = torn && !r.purchaseDate;

  if (!missingTop) {
    text(r.store.name, { x: W / 2, anchor: "middle", size: 22, weight: 700 });
    y += 24;
    text(r.store.address, { x: W / 2, anchor: "middle", size: 13 });
    y += 26;
    if (r.purchaseDate) {
      const [yy, mm, dd] = r.purchaseDate.split("-");
      text(`תאריך: ${dd}/${mm}/${yy}`);
      rows.push(`<text x="${PAD}" y="${y}" direction="rtl" text-anchor="end" font-size="15">שעה: ${r.time}</text>`);
      y += 22;
    }
    if (r.receiptNumber) {
      text(`קבלה מס': ${r.receiptNumber}`);
      y += 22;
    }
  } else {
    y += 30;
  }
  rule();

  for (const l of r.lines) {
    if (l.lineType === "item" || l.lineType === "return") {
      text(l.description, { weight: 500 });
      y += 20;
      const qty = l.unit === "kg" ? `${l.quantity.toFixed(3)} ק"ג` : `${l.quantity} יח'`;
      const price = l.unitPriceAgorot != null ? ` × ${(l.unitPriceAgorot / 100).toFixed(2)}` : "";
      text(`${qty}${price}`, { x: right - 14, size: 13 });
      amount(l.lineTotalAgorot);
      y += 20;
      if (l.discountAgorot) {
        text("הנחת מבצע", { x: right - 14, size: 13 });
        amount(-l.discountAgorot);
        y += 20;
      }
    } else {
      text(l.description, { weight: 500 });
      amount(l.lineTotalAgorot);
      y += 22;
    }
  }
  y += 4;
  rule();
  if (r.totalAgorot != null && !(torn && r.purchaseDate)) {
    text('סה"כ לתשלום', { size: 18, weight: 700 });
    rows.push(`<text x="${PAD}" y="${y}" direction="ltr" text-anchor="start" font-size="18" font-weight="700">${(r.totalAgorot / 100).toFixed(2)}</text>`);
    y += 30;
    text("תודה ולהתראות!", { x: W / 2, anchor: "middle", size: 14 });
    y += 26;
  } else {
    y += 40;
  }

  const H = y + 20;
  const blur = r.imageStyle === "blurry";
  const tornEdge = torn
    ? r.purchaseDate
      ? `<path d="M0 ${H - 46} ${Array.from({ length: 22 }, (_, i) => `L${(i + 1) * 20} ${H - 46 + (i % 2 ? 14 : -6)}`).join(" ")} L${W} ${H} L0 ${H} Z" fill="#d9dce1"/>`
      : `<path d="M0 0 L${W} 0 L${W} 44 ${Array.from({ length: 22 }, (_, i) => `L${W - (i + 1) * 20} ${44 + (i % 2 ? -14 : 6)}`).join(" ")} L0 44 Z" fill="#d9dce1"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Courier New', 'Noto Sans Hebrew', 'Arial', monospace">
<defs>${blur ? '<filter id="b"><feGaussianBlur stdDeviation="0.9"/></filter>' : ""}</defs>
<rect width="${W}" height="${H}" fill="#fbfaf6"/>
<g fill="#222"${blur ? ' filter="url(#b)" opacity="0.78"' : ""}>
${rows.join("\n")}
</g>
${tornEdge}
<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#9aa1ab" direction="rtl">קבלה לדוגמה — נתונים בדיוניים</text>
</svg>`;
}
